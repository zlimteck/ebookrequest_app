import dotenv from 'dotenv';
import mongoose from 'mongoose';
import AIRequestLog from '../models/AIRequestLog.js';
import Bestseller from '../models/Bestseller.js';
import { generateCompletion } from './aiProviderService.js';
import { findBestBookMatch } from './bookSearchService.js';
import { getAIProviderConfig } from './aiProviderConfig.js';
import { clearTrendingBooksCache } from './trendingBooksService.js';

dotenv.config();

// Catégories valides de Bestseller.category (enum) et leur libellé humain
// utilisé dans le prompt IA — doit rester synchronisé avec le tableau
// `categories` de frontend/src/components/admin/BestsellerManagement.jsx.
export const CATEGORY_LABELS = {
  thriller: 'Thriller & Policier',
  romance:  'Romance',
  sf:       'Science-Fiction',
  bd:       'BD & Manga',
  fantasy:  'Fantasy',
  literary: 'Littéraire',
};

function categoryIdForLabel(label) {
  return Object.entries(CATEGORY_LABELS).find(([, l]) => l === label)?.[0] || null;
}

// Enregistre les bestsellers générés en base (dédoublonnage par titre+auteur+
// catégorie, n'écrase jamais les entrées déjà présentes) — partagé entre la
// génération manuelle (admin) et la génération automatique mensuelle. Chaque
// livre est inséré indépendamment (une catégorie ou un livre en erreur ne
// bloque pas les suivants), et le libellé renvoyé par l'IA (ex. "Thriller &
// Policier") est traduit vers l'identifiant valide de l'enum (ex. "thriller").
export async function saveBestsellers(bestsellers, addedBy) {
  let savedCount = 0;
  for (const [categoryLabel, books] of Object.entries(bestsellers)) {
    const category = categoryIdForLabel(categoryLabel);
    if (!category) {
      console.warn(`[Bestsellers] Catégorie inconnue ignorée: "${categoryLabel}"`);
      continue;
    }
    for (const book of books) {
      try {
        const existing = await Bestseller.findOne({ title: book.title, author: book.author, category });
        if (existing) continue;
        await Bestseller.create({
          title: book.title,
          author: book.author,
          category,
          order: book.order || 0,
          reason: book.reason,
          thumbnail: book.thumbnail || null,
          description: book.description || book.reason,
          link: book.link || null,
          googleBooksId: book.googleBooksId || null,
          pageCount: book.pageCount || 0,
          publishedDate: book.publishedDate || null,
          active: true,
          addedBy,
        });
        savedCount++;
      } catch (err) {
        console.error(`[Bestsellers] Échec enregistrement "${book.title}":`, err.message);
      }
    }
  }
  if (savedCount > 0) clearTrendingBooksCache();
  return savedCount;
}

// Génère les bestsellers du mois pour les catégories spécifiées
export const generateBestsellers = async (categories = [], userId = null, username = 'admin') => {
  const startTime = Date.now();

  try {
    if (!categories || categories.length === 0) {
      categories = Object.values(CATEGORY_LABELS);
    }

    const currentMonth = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

    // Créer le prompt pour l'IA
    const prompt = buildBestsellerPrompt(categories, currentMonth);

    console.log('Generating bestsellers with AI provider...', { categories, month: currentMonth });

    // Appel à l'API via aiProviderService
    const result = await generateCompletion(prompt, {
      temperature: 0.5,  // Température plus basse pour des résultats plus précis
      top_p: 0.8,
      top_k: 30,
      max_tokens: 2500,  // Pour supporter plusieurs catégories
      timeout: 180000 // 3 minutes timeout
    });

    console.log('Response received from AI provider for bestsellers');

    const responseTime = Date.now() - startTime;

    // Parser la réponse
    let bestsellers = parseBestsellers(result.text, categories);

    // Enrichir avec Google Books API
    bestsellers = await enrichBestsellersWithGoogleBooks(bestsellers);

    // Logger la requête réussie
    if (userId) {
      try {
        await AIRequestLog.create({
          userId,
          username,
          requestType: 'bestseller',
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
      success: true,
      bestsellers,
      month: currentMonth,
      message: `${Object.keys(bestsellers).length} catégories générées`
    };

  } catch (error) {
    console.error('Erreur lors de la génération des bestsellers:', error.message);

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
          requestType: 'bestseller',
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
    throw new Error(`Erreur lors de la génération: ${error.message}`);
  }
};

// Construit le prompt pour générer les bestsellers
function buildBestsellerPrompt(categories, month) {
  const categoriesList = categories.map(cat => `"${cat}"`).join(', ');

  return `Tu es un expert en littérature qui connaît parfaitement les tendances actuelles du marché du livre.

Pour le mois de ${month}, donne-moi le TOP 5 des livres les plus vendus et les plus populaires pour chacune de ces catégories : ${categoriesList}

Pour chaque livre, fournis les informations au format JSON suivant :

{
  "category": "Nom EXACT de la catégorie (tel que fourni ci-dessus)",
  "books": [
    {
      "title": "Titre exact du livre",
      "author": "Nom de l'auteur",
      "reason": "Courte phrase expliquant pourquoi c'est un bestseller actuel"
    }
  ]
}

RÈGLES IMPORTANTES:
- Utilise EXACTEMENT les noms de catégories fournis ci-dessus (avec les "&" et espaces)
- Utilise UNIQUEMENT des livres qui existent réellement
- Concentre-toi sur les sorties récentes et les bestsellers actuels
- Donne des titres EXACTS (pas d'approximations)
- 5 livres par catégorie maximum
- NE PAS diviser une catégorie en plusieurs (ex: "Thriller & Policier" reste UNE catégorie)

Réponds UNIQUEMENT avec un tableau JSON valide contenant les catégories et leurs livres, sans texte supplémentaire :
[
  {
    "category": "Manga & BD",
    "books": [...]
  },
  {
    "category": "Thriller & Policier",
    "books": [...]
  }
]`;
}

// Parse la réponse d'Ollama pour extraire les bestsellers
function parseBestsellers(response, categories) {
  try {
    let cleanedResponse = response.trim();

    // Extraire le JSON (chercher le premier [ et le dernier ])
    const startIndex = cleanedResponse.indexOf('[');
    const endIndex = cleanedResponse.lastIndexOf(']');

    if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
      cleanedResponse = cleanedResponse.substring(startIndex, endIndex + 1);
    }

    const parsed = JSON.parse(cleanedResponse);
    const result = {};

    if (Array.isArray(parsed)) {
      for (const categoryData of parsed) {
        if (categoryData.category && Array.isArray(categoryData.books)) {
          result[categoryData.category] = categoryData.books
            .filter(book => book.title && book.author)
            .slice(0, 5)
            .map((book, index) => ({
              title: book.title.trim(),
              author: book.author.trim(),
              reason: book.reason?.trim() || 'Bestseller du moment',
              order: index + 1
            }));
        }
      }
    }

    console.log(`Bestsellers parsés: ${Object.keys(result).length} catégories`);
    return result;

  } catch (error) {
    console.error('Erreur lors du parsing:', error.message);
    console.error('Réponse brute:', response.substring(0, 500));

    // Fallback : retourner une structure vide
    return {};
  }
}

// Enrichit les bestsellers avec les données Google Books / Hardcover / Open
// Library, et écarte les livres qu'aucune des 3 sources ne confirme — l'IA
// invente parfois des titres plausibles mais inexistants (ou des variantes
// erronées d'un vrai livre) ; sans confirmation externe, mieux vaut ne pas
// l'afficher plutôt que de montrer une entrée sans couverture ni lien, non
// vérifiable par l'utilisateur.
async function enrichBestsellersWithGoogleBooks(bestsellers) {
  const enriched = {};

  for (const [category, books] of Object.entries(bestsellers)) {
    const results = await Promise.all(
      books.map(async (book) => {
        try {
          const match = await findBestBookMatch({ title: book.title, author: book.author });
          if (match) {
            return {
              ...book,
              thumbnail: match.thumbnail,
              description: match.description || book.reason,
              link: match.link || `https://books.google.fr/books?id=${match.id}`,
              googleBooksId: match.id,
              pageCount: match.pageCount,
              publishedDate: match.publishedDate,
            };
          }
        } catch (error) {
          console.error(`Erreur recherche livre pour "${book.title}":`, error.message);
        }
        return null;
      })
    );
    const confirmed = results.filter(Boolean);
    if (confirmed.length > 0) enriched[category] = confirmed;
  }

  return enriched;
}