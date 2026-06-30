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

// ─── Open Library fallback ────────────────────────────────────────────────────

function normalizeOpenLibraryISBN(data, isbn) {
  const cover = data.cover?.large || data.cover?.medium || data.cover?.small || null;
  const year = (data.publish_date || '').match(/\d{4}/)?.[0] || '';
  return {
    id: `ol-isbn-${isbn}`,
    volumeInfo: {
      title:         data.title || '',
      authors:       (data.authors || []).map(a => a.name).filter(Boolean),
      publishedDate: year,
      description:   'Aucune description disponible',
      pageCount:     data.number_of_pages || 0,
      categories:    [],
      imageLinks:    { thumbnail: cover, smallThumbnail: cover },
      language:      'fr',
      previewLink:   `https://openlibrary.org/isbn/${isbn}`,
      infoLink:      `https://openlibrary.org/isbn/${isbn}`,
      seriesInfo:    null,
    },
  };
}

function normalizeOpenLibrarySearch(doc) {
  const coverUrl = doc.cover_i
    ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
    : null;
  const key = (doc.key || '').replace('/works/', '');
  return {
    id: `ol-${key || Math.random().toString(36).slice(2)}`,
    volumeInfo: {
      title:         doc.title || '',
      authors:       doc.author_name || ['Auteur inconnu'],
      publishedDate: doc.first_publish_year ? String(doc.first_publish_year) : '',
      description:   'Aucune description disponible',
      pageCount:     doc.number_of_pages_median || 0,
      categories:    [],
      imageLinks:    { thumbnail: coverUrl, smallThumbnail: coverUrl },
      language:      'fr',
      previewLink:   `https://openlibrary.org${doc.key || ''}`,
      infoLink:      `https://openlibrary.org${doc.key || ''}`,
      seriesInfo:    null,
    },
  };
}

async function fetchFromOpenLibraryISBN(isbn) {
  const res = await axios.get('https://openlibrary.org/api/books', {
    params: { bibkeys: `ISBN:${isbn}`, format: 'json', jscmd: 'data' },
    timeout: 8000,
  });
  const data = res.data[`ISBN:${isbn}`];
  return data ? normalizeOpenLibraryISBN(data, isbn) : null;
}

async function fetchFromOpenLibrarySearch(q, limit) {
  const res = await axios.get('https://openlibrary.org/search.json', {
    params: {
      q,
      limit,
      fields: 'key,title,author_name,cover_i,first_publish_year,number_of_pages_median',
    },
    timeout: 8000,
  });
  return (res.data.docs || []).map(normalizeOpenLibrarySearch);
}

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
        infoLink:    book.volumeInfo.infoLink    || '',
        seriesInfo:  book.volumeInfo.seriesInfo  || null,
      }
    };
  });
}

function extractTomeNumber(volumeInfo) {
  const si = volumeInfo?.seriesInfo;
  if (si?.bookDisplayNumber) {
    const n = parseFloat(si.bookDisplayNumber);
    if (!isNaN(n)) return n;
  }
  if (si?.volumeSeries?.[0]?.orderNumber) return si.volumeSeries[0].orderNumber;
  const title = volumeInfo?.title || '';
  const patterns = [/tome\s*(\d+(?:\.\d+)?)/i, /vol(?:ume)?\.?\s*(\d+(?:\.\d+)?)/i, /#\s*(\d+(?:\.\d+)?)/i, /,\s*t\.?\s*(\d+(?:\.\d+)?)/i, /\bno?\.?\s*(\d+(?:\.\d+)?)/i];
  for (const p of patterns) {
    const m = title.match(p);
    if (m) return parseFloat(m[1]);
  }
  return Infinity;
}

// Mots-clés qui signalent que ce n'est PAS un tome individuel
const SERIES_EXCLUDE_PATTERNS = [
  /coffret/i, /intégrale/i, /integrale/i, /box\s*set/i,
  /analyse\s+de\s+l['']oeuvre/i, /fiche\s+de\s+lecture/i,
  /décrypt/i, /decrypt/i, /guide\s+(de|du|des)/i, /companion/i,
  /encyclop/i, /making\s+of/i, /\bcomics?\b/i,
];

// Recherche des autres tomes d'une série
router.get('/series-tomes', async (req, res) => {
  try {
    const { name, excludeId } = req.query;
    if (!name) return res.status(400).json({ error: 'Nom de série requis' });

    // Tenter plusieurs stratégies de requête, fusionner et dédupliquer
    const queries = [
      `intitle:"${name}" tome`,
      `intitle:"${name}"`,
      name,
    ];

    const seen = new Set();
    let rawItems = [];

    for (const q of queries) {
      const result = await fetchFromGoogle(q, 40, 0);
      for (const item of result.items) {
        if (!seen.has(item.id)) {
          seen.add(item.id);
          rawItems.push(item);
        }
      }
      if (rawItems.length >= 20) break;
    }

    // Filtrer : exclure le livre actuel, coffrets, analyses, hors-série
    const nameLC = name.toLowerCase();
    const filtered = rawItems.filter(b => {
      if (b.id === excludeId) return false;
      const title = (b.volumeInfo?.title || '').toLowerCase();
      if (!title.includes(nameLC)) return false;
      if (SERIES_EXCLUDE_PATTERNS.some(p => p.test(b.volumeInfo?.title || ''))) return false;
      // Exclure les titres avec ";" (plusieurs volumes dans un coffret)
      if ((b.volumeInfo?.title || '').includes(';')) return false;
      return true;
    });

    // Trier par numéro de tome
    filtered.sort((a, b) => {
      const numA = extractTomeNumber(a.volumeInfo);
      const numB = extractTomeNumber(b.volumeInfo);
      return numA - numB;
    });

    res.json({ results: formatPool(filtered) });
  } catch (err) {
    console.error('[Google Books] Erreur series-tomes:', err.message);
    res.status(500).json({ error: 'Erreur lors de la recherche de la série' });
  }
});

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

    // ── Fallback Open Library si Google Books n'a rien trouvé (page 1 seulement) ─
    if (rawItems.length === 0 && offset === 0 && !authorOnly) {
      try {
        const isbnClean = (q || '').trim().replace(/[-\s]/g, '');
        const isISBN = /^\d{10}$/.test(isbnClean) || /^\d{13}$/.test(isbnClean);

        if (isISBN) {
          const olResult = await fetchFromOpenLibraryISBN(isbnClean);
          if (olResult) {
            console.log(`[Books] Open Library fallback ISBN → "${olResult.volumeInfo.title}"`);
            return res.json({ results: [olResult], totalItems: 1 });
          }
        } else if (q?.trim()) {
          const olResults = await fetchFromOpenLibrarySearch(q.trim(), limit);
          if (olResults.length > 0) {
            console.log(`[Books] Open Library fallback → ${olResults.length} résultat(s)`);
            return res.json({ results: olResults, totalItems: olResults.length });
          }
        }
      } catch (olErr) {
        console.warn('[Books] Open Library fallback échoué:', olErr.message);
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
