import express from 'express';
import axios from 'axios';

const router = express.Router();
const GOOGLE_BOOKS_API_KEY = process.env.GOOGLE_BOOKS_API_KEY || '';

// Cache en mémoire : clé = "params", valeur = { data, expiresAt }
const searchCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getCacheKey(title, author, year, startIndex, limit) {
  return `${(title || '').toLowerCase().trim()}|${(author || '').toLowerCase().trim()}|${year || ''}|${startIndex}|${limit}`;
}

/**
 * Recherche titre seul ou ISBN.
 */
function buildQueries(q) {
  const clean = q.trim();

  // ISBN : 10 ou 13 chiffres (éventuellement avec tirets)
  const isbnClean = clean.replace(/[-\s]/g, '');
  if (/^\d{10}$/.test(isbnClean) || /^\d{13}$/.test(isbnClean)) {
    return [`isbn:${isbnClean}`];
  }

  return [clean];
}

/**
 * Recherche combinée "Auteur Titre" sans séparateur.
 * Stratégie : couper après 2 mots (Prénom Nom + Titre),
 * puis après 3 mots (Prénom Nom Composé + Titre), puis brut.
 * Ex : "Virginie Grimaldi D'autres printemps"
 *   → inauthor:"Virginie Grimaldi" intitle:"D'autres printemps"
 */
function buildCombinedQueries(q) {
  const clean = q.trim();

  // ISBN : déléguer à buildQueries qui gère déjà ce cas
  const isbnClean = clean.replace(/[-\s]/g, '');
  if (/^\d{10}$/.test(isbnClean) || /^\d{13}$/.test(isbnClean)) {
    return [`isbn:${isbnClean}`];
  }

  const words = clean.split(/\s+/);
  const queries = [];

  if (words.length >= 3) {
    queries.push(`inauthor:"${words.slice(0, 2).join(' ')}" intitle:"${words.slice(2).join(' ')}"`);
  }
  if (words.length >= 4) {
    queries.push(`inauthor:"${words.slice(0, 3).join(' ')}" intitle:"${words.slice(3).join(' ')}"`);
  }
  // Fallback brut (Google gère très bien les requêtes mixtes auteur+titre)
  queries.push(clean);

  return queries;
}

async function fetchFromGoogle(queryStr, limit, startIndex = 0, options = {}) {
  const response = await axios.get(
    'https://www.googleapis.com/books/v1/volumes',
    {
      params: {
        q:          queryStr,
        maxResults: limit,
        startIndex,
        key:        GOOGLE_BOOKS_API_KEY,
        printType:  'books',
        orderBy:    'relevance',
        ...(options.langRestrict && { langRestrict: options.langRestrict }),
      },
      timeout: 8000,
    }
  );
  return {
    items:      response.data.items      || [],
    totalItems: response.data.totalItems || 0,
  };
}

const toHttps = (url) => url ? url.replace(/^http:\/\//, 'https://') : url;

function formatPool(items) {
  return items.map(book => {
    const imageLinks = book.volumeInfo.imageLinks || {};
    return {
      id: book.id,
      volumeInfo: {
        title:         book.volumeInfo.title,
        authors:       book.volumeInfo.authors || ['Auteur inconnu'],
        publishedDate: book.volumeInfo.publishedDate,
        description:   book.volumeInfo.description || 'Aucune description disponible',
        pageCount:     book.volumeInfo.pageCount || 0,
        categories:    book.volumeInfo.categories || [],
        imageLinks: {
          thumbnail:      toHttps(imageLinks.thumbnail),
          smallThumbnail: toHttps(imageLinks.smallThumbnail),
        },
        language:    book.volumeInfo.language    || 'fr',
        previewLink: book.volumeInfo.previewLink || '',
      }
    };
  });
}

// Recherche de livres via Google Books API
router.get('/search', async (req, res) => {
  try {
    const { q, author, combined, maxResults = 10, startIndex = 0 } = req.query;

    if (!q && !author) {
      return res.status(400).json({ message: 'Un titre ou un auteur est requis' });
    }

    const limit  = Math.min(parseInt(maxResults) || 10, 10);
    const offset = Math.max(parseInt(startIndex)  || 0,  0);

    // Pour auteur seul, la clé de cache ignore l'offset (pool complet mis en cache)
    const authorOnly = !!(author?.trim() && !q?.trim());
    const cacheKey   = authorOnly
      ? getCacheKey(q, author, 'pool', 0, 40)
      : getCacheKey(q, author, '', offset, limit);

    // Retourner le cache si valide
    const cached = searchCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      if (authorOnly) {
        // Pool en cache → paginer et renvoyer le bon slice
        const pool = cached.data.pool;
        return res.json({ results: formatPool(pool.slice(offset, offset + limit)), totalItems: pool.length });
      }
      return res.json(cached.data);
    }

    // Construire les requêtes selon les paramètres fournis
    let queries;
    if (q?.trim() && author?.trim()) {
      // Guillemets pour forcer la recherche de phrase exacte
      queries = [
        `intitle:"${q.trim()}" inauthor:"${author.trim()}"`,
        `${q.trim()} inauthor:"${author.trim()}"`,
        q.trim(),
      ];
    } else if (authorOnly) {
      queries = [`inauthor:"${author.trim()}"`, author.trim()];
    } else if (combined === 'true' && q?.trim()) {
      queries = buildCombinedQueries(q);
    } else {
      queries = buildQueries(q);
    }

    let rawItems   = [];
    let totalItems = 0;

    if (authorOnly) {
      // Pool auteur seul : fetcher 40 depuis offset 0, filtrer FR,
      // trier par date, mettre en cache le pool entier, paginer dedans.
      // → totalItems = taille réelle du pool filtré (pas le total Google toutes langues)
      let pool = [];
      for (const queryStr of queries) {
        const result = await fetchFromGoogle(queryStr, 40, 0, { langRestrict: 'fr' });
        if (result.items.length > 0) {
          pool = result.items;
          break;
        }
      }
      pool = pool.filter(item =>
        !item.volumeInfo?.language || item.volumeInfo.language === 'fr'
      );
      pool.sort((a, b) => {
        const yearA = parseInt((a.volumeInfo?.publishedDate || '').slice(0, 4)) || 0;
        const yearB = parseInt((b.volumeInfo?.publishedDate || '').slice(0, 4)) || 0;
        return yearB - yearA;
      });
      // Mettre le pool en cache (format spécifique)
      searchCache.set(cacheKey, { data: { pool }, expiresAt: Date.now() + CACHE_TTL_MS });
      rawItems   = pool.slice(offset, offset + limit);
      totalItems = pool.length;
    } else {
      for (const queryStr of queries) {
        const result = await fetchFromGoogle(queryStr, limit, offset);
        if (result.items.length > 0) {
          rawItems   = result.items;
          totalItems = result.totalItems;
          break;
        }
      }
      // Fallback titre brut si aucun résultat structuré (page 1 seulement)
      if (rawItems.length === 0 && queries.length > 1 && offset === 0 && q?.trim()) {
        const result = await fetchFromGoogle(q.trim(), limit, 0);
        rawItems   = result.items;
        totalItems = result.totalItems;
      }
    }

    const responseData = { results: formatPool(rawItems), totalItems };

    // Mettre en cache (seulement pour les recherches non-auteur, le pool auteur est déjà caché)
    if (!authorOnly) {
      searchCache.set(cacheKey, { data: responseData, expiresAt: Date.now() + CACHE_TTL_MS });
    }

    // Nettoyer les entrées expirées toutes les 100 requêtes
    if (searchCache.size % 100 === 0) {
      const now = Date.now();
      for (const [key, val] of searchCache.entries()) {
        if (val.expiresAt <= now) searchCache.delete(key);
      }
    }

    res.json(responseData);
  } catch (error) {
    console.error('Erreur lors de la recherche Google Books:', error.message);

    // Si rate limit (429) ou service indisponible (503), retourner cache expiré si dispo
    if (error.response?.status === 429 || error.response?.status === 503) {
      const limit  = Math.min(parseInt(req.query.maxResults || 10), 10);
      const offset = parseInt(req.query.startIndex) || 0;
      const cacheKey = getCacheKey(req.query.q, req.query.author, '', offset, limit);
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
