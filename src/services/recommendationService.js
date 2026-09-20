import dotenv from 'dotenv';
import mongoose from 'mongoose';
import AIRequestLog from '../models/AIRequestLog.js';
import BookRequest from '../models/BookRequest.js';
import ReadingList from '../models/ReadingList.js';
import Recommendation from '../models/Recommendation.js';
import { generateCompletion } from './aiProviderService.js';
import { findBestBookMatch } from './bookSearchService.js';
import { getAIProviderConfig } from './aiProviderConfig.js';

dotenv.config();

export async function getUserBookRequests(userId) {
  return BookRequest.find({ user: userId })
    .sort({ createdAt: -1 })
    .select('title author description pageCount')
    .lean();
}

// Livres lus, notes en premier (meilleur signal de goût) — limité pour ne pas
// gonfler le prompt inutilement sur une grosse bibliothèque.
export async function getUserLibraryBooks(userId) {
  return ReadingList.find({ userId, status: 'read' })
    .sort({ rating: -1, updatedAt: -1 })
    .select('title author rating')
    .limit(30)
    .lean();
}

// Retourne les recommandations en cache pour un utilisateur, ou les génère
// gratuitement (sans consommer son quota de régénération) si aucun cache
// n'existe encore — même logique que GET /api/recommendations, réutilisée par
// le chatbot pour ne pas dupliquer la génération/le cache.
export async function getOrGenerateRecommendations(userId, username, limit = 5) {
  const cached = await Recommendation.findOne({ user: userId });
  if (cached && cached.recommendations.length > 0) {
    return { recommendations: cached.recommendations, cached: true };
  }

  const [bookRequests, libraryBooks] = await Promise.all([
    getUserBookRequests(userId),
    getUserLibraryBooks(userId),
  ]);
  const result = await generateRecommendations(bookRequests, limit, userId, username, libraryBooks);

  await Recommendation.findOneAndUpdate(
    { user: userId },
    { recommendations: result.recommendations, generatedAt: new Date(), regenerationCount: 0, windowStart: new Date() },
    { upsert: true }
  );

  return { recommendations: result.recommendations, cached: false, message: result.message };
}

// Génère des recommandations de livres basées sur l'historique des demandes et,
// si fournie, la bibliothèque de lecture (livres marqués lus, notes) — un
// signal plus direct des goûts réels que la seule liste de demandes.
export const generateRecommendations = async (bookRequests, limit = 5, userId = null, username = 'anonymous', libraryBooks = []) => {
  const startTime = Date.now();
  let logEntry = null;

  try {
    // Vérifier qu'il y a au moins une source de signal (demandes ou bibliothèque)
    if ((!bookRequests || bookRequests.length === 0) && (!libraryBooks || libraryBooks.length === 0)) {
      return {
        recommendations: [],
        message: "Vous n'avez pas encore de demandes de livres ni de bibliothèque de lecture. Commencez par demander ou ajouter quelques livres pour obtenir des recommandations personnalisées !"
      };
    }

    // Préparer les données pour l'IA
    const booksData = (bookRequests || []).map(req => ({
      title: req.title,
      author: req.author,
      description: req.description || '',
      pageCount: req.pageCount || 0
    }));

    const libraryData = (libraryBooks || []).map(b => ({
      title: b.title,
      author: b.author,
      rating: b.rating || 0,
    }));

    // Créer le prompt pour l'IA
    const prompt = buildRecommendationPrompt(booksData, limit, libraryData);

    console.log('Sending request to AI provider...');

    // Appel à l'API via aiProviderService
    const result = await generateCompletion(prompt, {
      temperature: 0.7,
      top_p: 0.9,
      top_k: 40,
      timeout: 60000 // 60 secondes timeout
    });

    console.log('Response received from AI provider');

    const responseTime = Date.now() - startTime;

    // Parser la réponse
    let recommendations = parseRecommendations(result.text);

    // Enrichir avec les couvertures de Google Books
    recommendations = await enrichWithGoogleBooksCovers(recommendations);

    // Logger la requête réussie
    if (userId) {
      try {
        logEntry = await AIRequestLog.create({
          userId,
          username,
          requestType: 'recommendation',
          provider: result.provider,
          model: result.model,
          success: true,
          responseTime,
          tokensUsed: result.tokensUsed || null
        });
      } catch (logError) {
        console.error('Erreur lors du logging de la requête IA:', logError.message);
      }
    }

    return {
      recommendations,
      message: recommendations.length > 0
        ? `Basé sur vos ${bookRequests.length} demande(s) de livres`
        : "Impossible de générer des recommandations pour le moment"
    };

  } catch (error) {
    console.error('Erreur lors de la génération de recommandations:', error.message);

    const responseTime = Date.now() - startTime;

    // Logger la requête échouée
    if (userId) {
      try {
        const cfg = await getAIProviderConfig();
        const provider = cfg.provider || 'other';
        const model = provider === 'openai'
          ? cfg.openaiModel
          : provider === 'claude'
            ? cfg.claudeModel
            : (cfg.ollamaModel || 'unknown');

        await AIRequestLog.create({
          userId,
          username,
          requestType: 'recommendation',
          provider,
          model,
          success: false,
          errorMessage: error.message,
          responseTime
        });
      } catch (logError) {
        console.error('Erreur lors du logging de la requête IA:', logError.message);
      }
    }

    // Error is already formatted by aiProviderService
    throw new Error(`Erreur lors de la génération de recommandations: ${error.message}`);
  }
};

// Construit le prompt pour Ollama
function buildRecommendationPrompt(books, limit, libraryBooks = []) {
  const booksList = books.map((book, index) =>
    `${index + 1}. "${book.title}" par ${book.author}${book.description ? ` - ${book.description.substring(0, 200)}` : ''}`
  ).join('\n');

  const libraryList = libraryBooks.map((book, index) =>
    `${index + 1}. "${book.title}" par ${book.author}${book.rating ? ` (noté ${book.rating}/5)` : ''}`
  ).join('\n');

  const sections = [
    booksList && `Livres demandés sur l'application :\n${booksList}`,
    libraryList && `Bibliothèque de lecture personnelle (livres lus, avec note quand disponible) :\n${libraryList}`,
  ].filter(Boolean).join('\n\n');

  return `Tu es un expert en littérature qui recommande des livres. Voici les données de lecture d'un utilisateur :

${sections}

Basé sur ces données (privilégie les livres les mieux notés dans la bibliothèque personnelle comme signal de goût), recommande exactement ${limit} livres différents qui pourraient intéresser cet utilisateur. Pour chaque recommandation, fournis les informations au format JSON suivant :

{
  "title": "Titre du livre",
  "author": "Auteur du livre",
  "reason": "Raison de cette recommandation en 1-2 phrases courtes",
  "genre": "Genre principal du livre"
}

Réponds UNIQUEMENT avec un tableau JSON valide contenant ${limit} recommandations, sans texte supplémentaire avant ou après. Format attendu :
[
  { "title": "...", "author": "...", "reason": "...", "genre": "..." },
  ...
]`;
}

/**
 * Parse la réponse de Ollama pour extraire les recommandations
 * @param {string} response - Réponse brute de Ollama
 * @returns {Array} Liste de recommandations parsées
 */
function parseRecommendations(response) {
  try {
    // Nettoyer la réponse
    let cleanedResponse = response.trim();

    // Extraire le JSON si entouré de texte
    const jsonMatch = cleanedResponse.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (jsonMatch) {
      cleanedResponse = jsonMatch[0];
    }

    // Parser le JSON
    const recommendations = JSON.parse(cleanedResponse);

    // Valider et formater les recommandations
    if (Array.isArray(recommendations)) {
      return recommendations
        .filter(rec => rec.title && rec.author && rec.reason)
        .map(rec => ({
          title: rec.title.trim(),
          author: rec.author.trim(),
          reason: rec.reason.trim(),
          genre: rec.genre?.trim() || 'Non spécifié',
          id: generateRecommendationId(rec.title, rec.author)
        }));
    }

    console.warn('Format de réponse inattendu de Ollama:', response.substring(0, 200));
    return [];

  } catch (error) {
    console.error('Erreur lors du parsing des recommandations:', error.message);
    console.error('Réponse brute:', response.substring(0, 500));

    // Fallback: essayer d'extraire manuellement
    return extractRecommendationsManually(response);
  }
}

// Extraction manuelle des recommandations si le JSON parsing échoue
function extractRecommendationsManually(response) {
  const recommendations = [];

  try {
    // Chercher des patterns de type "Titre" par Auteur
    const patterns = [
      /["']([^"']+)["']\s+(?:par|by)\s+([^,.\n]+)/gi,
      /(\d+)\.\s*["']?([^"'\n]+)["']?\s*-\s*([^,\n]+)/gi
    ];

    for (const pattern of patterns) {
      const matches = [...response.matchAll(pattern)];
      for (const match of matches) {
        if (match.length >= 3) {
          recommendations.push({
            title: match[1].trim(),
            author: match[2].trim(),
            reason: "Recommandé sur la base de vos lectures précédentes",
            genre: "Non spécifié",
            id: generateRecommendationId(match[1], match[2])
          });
        }
      }
    }
  } catch (error) {
    console.error('Erreur extraction manuelle:', error.message);
  }

  return recommendations.slice(0, 5);
}

// Génère un ID unique pour une recommandation
function generateRecommendationId(title, author) {
  const str = `${title}-${author}`.toLowerCase().replace(/[^a-z0-9]/g, '');
  return str.substring(0, 50);
}

// Enrichit les recommandations avec les couvertures de Google Books.
// Écarte les recommandations qu'aucune source (Google Books/Hardcover/Open
// Library) ne confirme — évite d'afficher un titre inventé ou mal orthographié
// par l'IA sans aucun moyen pour l'utilisateur de vérifier qu'il existe.
async function enrichWithGoogleBooksCovers(recommendations) {
  if (recommendations.length === 0) return recommendations;

  const results = await Promise.all(
    recommendations.map(async (rec) => {
      try {
        const match = await findBestBookMatch({ title: rec.title, author: rec.author });
        if (match) {
          return {
            ...rec,
            thumbnail: match.thumbnail,
            link: match.link,
            description: match.description || rec.reason,
          };
        }
      } catch (error) {
        console.error(`Erreur lors de la récupération de la couverture pour "${rec.title}":`, error.message);
      }
      return null;
    })
  );
  return results.filter(Boolean);
}

// Test de connectivité avec le provider AI configuré
export { testAIProviderConnection as testOllamaConnection } from './aiProviderService.js';