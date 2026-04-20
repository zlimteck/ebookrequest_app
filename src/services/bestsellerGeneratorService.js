import axios from 'axios';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import AIRequestLog from '../models/AIRequestLog.js';
import { generateCompletion } from './aiProviderService.js';

dotenv.config();

const GOOGLE_BOOKS_API_KEY = process.env.GOOGLE_BOOKS_API_KEY;

// Génère les bestsellers du mois pour les catégories spécifiées
export const generateBestsellers = async (categories = [], userId = null, username = 'admin') => {
  const startTime = Date.now();

  try {
    if (!categories || categories.length === 0) {
      categories = ['Roman', 'Science-Fiction', 'Thriller', 'Fantasy', 'Romance'];
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
        // Try to determine provider from environment, fallback to 'other'
        const provider = process.env.AI_PROVIDER || 'other';
        const model = provider === 'openai'
          ? (process.env.OPENAI_MODEL || 'gpt-4o-mini')
          : (process.env.OLLAMA_MODEL || 'unknown');

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

// Enrichit les bestsellers avec les données Google Books
async function enrichBestsellersWithGoogleBooks(bestsellers) {
  if (!GOOGLE_BOOKS_API_KEY) {
    console.warn('Google Books API Key manquante, pas d\'enrichissement');
    return bestsellers;
  }

  const enriched = {};

  for (const [category, books] of Object.entries(bestsellers)) {
    enriched[category] = await Promise.all(
      books.map(async (book) => {
        try {
          const query = `intitle:${encodeURIComponent(book.title)}+inauthor:${encodeURIComponent(book.author)}`;
          const url = `https://www.googleapis.com/books/v1/volumes?q=${query}&key=${GOOGLE_BOOKS_API_KEY}&maxResults=1`;

          const response = await axios.get(url, { timeout: 5000 });

          if (response.data.items && response.data.items.length > 0) {
            const googleBook = response.data.items[0];
            const volumeInfo = googleBook.volumeInfo;

            return {
              ...book,
              thumbnail: volumeInfo.imageLinks?.thumbnail?.replace('http://', 'https://') || null,
              description: volumeInfo.description || book.reason,
              link: volumeInfo.infoLink || `https://books.google.fr/books?id=${googleBook.id}`,
              googleBooksId: googleBook.id,
              pageCount: volumeInfo.pageCount || 0,
              publishedDate: volumeInfo.publishedDate || null
            };
          }
        } catch (error) {
          console.error(`Erreur Google Books pour "${book.title}":`, error.message);
        }

        return book;
      })
    );
  }

  return enriched;
}