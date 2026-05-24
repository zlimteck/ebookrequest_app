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

/**
 * Transforme une requête en langage naturel en requête structurée Google Books.
 * Détecte les patterns : "Titre de Auteur", "Titre par Auteur", "ISBN"
 * et retourne un tableau de requêtes à essayer dans l'ordre.
 */
function buildQueries(q) {
  const clean = q.trim();

  // ISBN : 10 ou 13 chiffres (éventuellement avec tirets)
  const isbnClean = clean.replace(/[-\s]/g, '');
  if (/^\d{10}$/.test(isbnClean) || /^\d{13}$/.test(isbnClean)) {
    return [`isbn:${isbnClean}`];
  }

  // Pattern "Titre de/par Auteur" (français)
  // Le mot après "de/par" doit commencer par une MAJUSCULE (→ nom propre = auteur)
  // Pas de flag i pour que [A-ZÀ-Ö] reste sensible à la casse
  const authorSepRe = /^(.+?)\s+(?:[Dd]e|[Pp]ar)\s+([A-ZÀ-Ö].+)$/;
  const m = clean.match(authorSepRe);
  if (m) {
    const title  = m[1].trim();
    const author = m[2].trim();
    // Requête structurée en premier, requête brute en fallback
    return [
      `intitle:${title} inauthor:${author}`,
      clean,
    ];
  }

  // Pas de pattern détecté → requête brute uniquement
  return [clean];
}

async function fetchFromGoogle(queryStr, limit) {
  const response = await axios.get(
    'https://www.googleapis.com/books/v1/volumes',
    {
      params: {
        q:          queryStr,
        maxResults: limit,
        key:        GOOGLE_BOOKS_API_KEY,
        printType:  'books',
        orderBy:    'relevance',
      },
      timeout: 8000,
    }
  );
  return response.data.items || [];
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

    // Construire la liste de requêtes à essayer
    const queries = buildQueries(q);
    let rawItems = [];

    for (const queryStr of queries) {
      rawItems = await fetchFromGoogle(queryStr, limit);
      if (rawItems.length > 0) break; // Stop dès qu'on a des résultats
    }

    // Si toujours rien (structured + brute), retry avec la requête brute originale
    if (rawItems.length === 0 && queries.length > 1) {
      rawItems = await fetchFromGoogle(q.trim(), limit);
    }

    const toHttps = (url) => url ? url.replace(/^http:\/\//, 'https://') : url;

    const formattedResults = rawItems.map(book => {
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