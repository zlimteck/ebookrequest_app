import express from 'express';
import axios from 'axios';

const router = express.Router();
const GOOGLE_BOOKS_API_KEY = process.env.GOOGLE_BOOKS_API_KEY || '';

// Cache en mémoire : clé = "query|maxResults", valeur = { data, expiresAt }
const searchCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCacheKey(q, maxResults) {
  return `${q.toLowerCase().trim()}|${maxResults}`;
}

// Recherche de livres via Google Books API
router.get('/search', async (req, res) => {
  try {
    const { q, maxResults = 5 } = req.query;

    if (!q) {
      return res.status(400).json({ message: 'Le paramètre de recherche est requis' });
    }

    const limit = Math.min(parseInt(maxResults), 10);
    const cacheKey = getCacheKey(q, limit);

    // Retourner le cache si valide
    const cached = searchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return res.json(cached.data);
    }

    const response = await axios.get(
      'https://www.googleapis.com/books/v1/volumes',
      {
        params: {
          q,
          maxResults: limit,
          key: GOOGLE_BOOKS_API_KEY,
          printType: 'books',
          orderBy: 'relevance',
        },
        timeout: 8000,
      }
    );

    const toHttps = (url) => url ? url.replace(/^http:\/\//, 'https://') : url;

    const formattedResults = (response.data.items || []).map(book => {
      const imageLinks = book.volumeInfo.imageLinks || {};
      return {
        id: book.id,
        volumeInfo: {
          title: book.volumeInfo.title,
          authors: book.volumeInfo.authors || ['Auteur inconnu'],
          publishedDate: book.volumeInfo.publishedDate,
          description: book.volumeInfo.description || 'Aucune description disponible',
          pageCount: book.volumeInfo.pageCount || 0,
          categories: book.volumeInfo.categories || [],
          imageLinks: {
            thumbnail: toHttps(imageLinks.thumbnail),
            smallThumbnail: toHttps(imageLinks.smallThumbnail),
          },
          language: book.volumeInfo.language || 'fr',
          previewLink: book.volumeInfo.previewLink || '',
        }
      };
    });

    // Mettre en cache
    searchCache.set(cacheKey, { data: formattedResults, expiresAt: Date.now() + CACHE_TTL_MS });

    // Nettoyer les entrées expirées toutes les 100 requêtes
    if (searchCache.size % 100 === 0) {
      const now = Date.now();
      for (const [key, val] of searchCache.entries()) {
        if (val.expiresAt <= now) searchCache.delete(key);
      }
    }

    res.json(formattedResults);
  } catch (error) {
    console.error('Erreur lors de la recherche Google Books:', error.message);

    // Si rate limit (429) ou service indisponible (503), retourner cache expiré si dispo
    if (error.response?.status === 429 || error.response?.status === 503) {
      const limit = Math.min(parseInt(req.query.maxResults || 5), 10);
      const cacheKey = getCacheKey(req.query.q, limit);
      const stale = searchCache.get(cacheKey);
      if (stale) return res.json(stale.data);
    }

    res.status(500).json({
      message: 'Erreur lors de la recherche de livres',
      error: error.message,
    });
  }
});

export default router;