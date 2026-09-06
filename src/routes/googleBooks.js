import express from 'express';
import axios from 'axios';
import { getGoogleBooksApiKey, isGoogleBooksSearchEnabled } from '../services/googleBooksConfig.js';
import { getHardcoverApiKey, takeHardcoverQuota } from '../services/hardcoverConfig.js';
import { getProxyConfig, getProxyAgent } from '../services/proxyConfig.js';

const router = express.Router();

// Exécute une requête axios en tenant compte du proxy configuré (mode 'default' :
// proxy en priorité avec repli direct ; mode 'fallback' : direct en priorité avec repli proxy).
async function axiosGetWithProxy(url, axiosOptions, label) {
  const proxy = await getProxyConfig();

  const direct = () => axios.get(url, axiosOptions);
  const viaProxy = () => axios.get(url, {
    ...axiosOptions,
    httpsAgent: getProxyAgent(proxy.url),
    proxy: false,
  });

  if (!proxy.enabled) return direct();

  const secondVia = proxy.mode === 'default' ? 'connexion directe' : 'proxy';
  const [first, second] = proxy.mode === 'default' ? [viaProxy, direct] : [direct, viaProxy];
  try {
    return await first();
  } catch (err) {
    console.warn(`[Books] ${label} échec sans/avec proxy (${err.response?.status || err.code || err.message}), tentative via ${secondVia}`);
    const result = await second();
    console.log(`[Books] ${label} réussi via ${secondVia}`);
    return result;
  }
}

// Même logique que axiosGetWithProxy, pour les appels POST (API GraphQL Hardcover).
async function axiosPostWithProxy(url, body, axiosOptions, label) {
  const proxy = await getProxyConfig();

  const direct = () => axios.post(url, body, axiosOptions);
  const viaProxy = () => axios.post(url, body, {
    ...axiosOptions,
    httpsAgent: getProxyAgent(proxy.url),
    proxy: false,
  });

  if (!proxy.enabled) return direct();

  const secondVia = proxy.mode === 'default' ? 'connexion directe' : 'proxy';
  const [first, second] = proxy.mode === 'default' ? [viaProxy, direct] : [direct, viaProxy];
  try {
    return await first();
  } catch (err) {
    console.warn(`[Books] ${label} échec sans/avec proxy (${err.response?.status || err.code || err.message}), tentative via ${secondVia}`);
    const result = await second();
    console.log(`[Books] ${label} réussi via ${secondVia}`);
    return result;
  }
}

// Toutes les formes d'apostrophe rencontrées : droite ('), courbes (‘ ’), backtick (`)
const APOSTROPHE_RE = /['‘’`]/g;

function stripAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function authorVariants(name) {
  const norm = s => s.replace(/\s+/g, ' ').trim();
  const variants = new Set();

  variants.add(name);
  // tirets → espaces
  const noHyphen = name.replace(/-/g, ' ');
  variants.add(noHyphen);
  // apostrophes → espace
  const noApos = name.replace(APOSTROPHE_RE, ' ');
  variants.add(noApos);
  // espaces après un point supprimés : "J. K." → "J.K."
  const compactDots = name.replace(/\.\s+/g, '.');
  variants.add(compactDots);
  // points supprimés entièrement : "J.K." → "JK", "J. K." → "J K"
  const noDots = name.replace(/\./g, '');
  variants.add(noDots);
  // compact sans points : "J.K. Rowling" → "JK Rowling"
  variants.add(compactDots.replace(/\./g, ''));
  // combinaisons tirets + apostrophes
  const noHyphenNoApos = noHyphen.replace(APOSTROPHE_RE, ' ');
  variants.add(noHyphenNoApos);
  // combinaisons tirets + points
  variants.add(noHyphen.replace(/\./g, ''));
  // combinaisons apostrophes + points
  variants.add(noApos.replace(/\./g, ''));
  // tirets + apostrophes + points, tout nettoyé
  variants.add(noHyphenNoApos.replace(/\./g, ''));
  // accents retirés (et combiné avec les nettoyages ci-dessus)
  variants.add(stripAccents(name));
  variants.add(stripAccents(noHyphenNoApos.replace(/\./g, '')));

  return [...variants].map(norm).filter(Boolean);
}
// Cache en mémoire : clé = "params", valeur = { data, expiresAt }
const searchCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Exposé pour un vidage manuel (route admin) — utile après un changement de config
// (clé API, toggle de service) pour forcer un résultat frais sans attendre le TTL.
export function clearBooksSearchCache() {
  const size = searchCache.size;
  searchCache.clear();
  return size;
}

// `googleEnabled` fait partie de la clé : sans ça, désactiver Google Books ne bust pas
// les entrées déjà en cache (jusqu'à 5 min) pour une requête identique testée avant/après
// le changement de réglage, qui continuerait sinon à renvoyer d'anciens résultats Google.
function getCacheKey(title, author, year, startIndex, limit, googleEnabled, mode = '') {
  return `${(title || '').toLowerCase().trim()}|${(author || '').toLowerCase().trim()}|${year || ''}|${startIndex}|${limit}|g${googleEnabled ? 1 : 0}|m${mode}`;
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
 * Recherche combinée "Auteur Titre" sans séparateur, OU simplement un titre
 * à plusieurs mots (le cas le plus frequent en pratique).
 *
 * (patch) Ordre reconstruit : on tente d'abord les hypotheses SANS RISQUE
 * (tout le texte est le titre), puis seulement en dernier recours les
 * decoupages "N premiers mots = auteur" — ceux-ci sont une pure supposition
 * qui echoue silencieusement sur un titre qui n'a pas d'auteur concatene
 * (ex: "Nous, avant l'innocence" → l'ancien code essayait
 * inauthor:"Nous, avant" intitle:"l'innocence" EN PREMIER, un faux-auteur
 * absurde qui pouvait remonter des resultats hors-sujet et empecher
 * d'essayer la requete brute, qui elle aurait trouve le bon livre).
 *
 * Ex (vrai cas auteur+titre) : "Virginie Grimaldi D'autres printemps"
 *   → en dernier recours : inauthor:"Virginie Grimaldi" intitle:"D'autres printemps"
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

  // 1. Hypothese sans risque : tout le texte est le titre
  queries.push(`intitle:"${clean}"`);
  // 2. Requete brute (Google gere tres bien les requetes mixtes auteur+titre)
  queries.push(clean);

  // 3. Dernier recours seulement : deviner un decoupage auteur/titre
  if (words.length >= 3) {
    queries.push(`inauthor:"${words.slice(0, 2).join(' ')}" intitle:"${words.slice(2).join(' ')}"`);
  }
  if (words.length >= 4) {
    queries.push(`inauthor:"${words.slice(0, 3).join(' ')}" intitle:"${words.slice(3).join(' ')}"`);
  }

  return queries;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Nombre de tentatives + backoff pour absorber les erreurs réseau/timeout/429/503 transitoires
// Les 503 (service indisponible / throttling IP) reçoivent plus de tentatives et un backoff
// plus long que les autres erreurs, car ils sont souvent liés à un throttling passager côté Google.
//
// (patch perf) Le plancher de 4 tentatives sur 503 était FIXE, sans exception — même un
// appelant demandant explicitement 0 retry (nos requêtes de repli spéculatives, voir
// firstNonEmptyGoogleResult) se voyait imposer jusqu'à 15s de backoff (1+2+4+8s) par
// requête. Vu qu'une recherche combinée/auteur peut tirer plusieurs requêtes de ce type,
// ça pouvait multiplier les secondes d'attente pour rien. `boost503` permet maintenant à
// l'appelant de désactiver ce plancher pour les requêtes non-critiques.
async function withRetry(fn, { retries = 2, label = '', boost503 = true } = {}) {
  let lastErr;
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err.response?.status;
      const retryable = !status || status === 429 || status === 503 || err.code === 'ECONNABORTED' || err.code === 'ECONNRESET';
      const maxRetries = (status === 503 && boost503) ? Math.max(retries, 4) : retries;
      if (!retryable || attempt === maxRetries) break;

      const retryAfterHeader = err.response?.headers?.['retry-after'];
      const retryAfterMs = retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1000 : null;
      const baseDelay = status === 503 ? 1000 : 500;
      const backoffMs = retryAfterMs || (baseDelay * Math.pow(2, attempt));

      console.warn(`[Books] ${label} échec (${status || err.code || err.message}), retry ${attempt + 1}/${maxRetries} dans ${backoffMs}ms`);
      await sleep(backoffMs);
      attempt++;
    }
  }
  throw lastErr;
}

export async function fetchFromGoogle(queryStr, limit, startIndex = 0, options = {}) {
  const apiKey = await getGoogleBooksApiKey();
  return withRetry(async () => {
    // DEBUG uniquement : GOOGLE_BOOKS_SIMULATE_503=1 force une 503 pour tester retry/fallback
    if (process.env.GOOGLE_BOOKS_SIMULATE_503 === '1') {
      const err = new Error('Simulated 503');
      err.response = { status: 503, headers: {} };
      throw err;
    }
    const response = await axiosGetWithProxy(
      'https://www.googleapis.com/books/v1/volumes',
      {
        params: {
          q:          queryStr,
          maxResults: limit,
          startIndex,
          key:        apiKey,
          printType:  'books',
          orderBy:    'relevance',
          ...(options.langRestrict && { langRestrict: options.langRestrict }),
        },
        timeout: 8000,
      },
      `Google Books "${queryStr}"`
    );
    return {
      items:      response.data.items      || [],
      totalItems: response.data.totalItems || 0,
    };
  }, { label: `Google Books "${queryStr}"`, retries: options.retries, boost503: options.boost503 });
}

const toHttps = (url) => url ? url.replace(/^http:\/\//, 'https://') : url;

// Retourne le premier résultat non vide, dans l'ordre de priorité des queries.
//
// (patch perf) Avant : `Promise.allSettled` tirait TOUTES les queries en parallèle
// à CHAQUE recherche, même quand la première (la plus fiable) suffisait déjà —
// jusqu'à 8-12 appels Google Books simultanés pour une simple recherche par auteur
// avec accents/tirets (voir authorVariants), ou 4 pour une recherche titre combinée.
// Volume × fréquence de recherche = plus de 429/503 côté Google, qui elle-même
// déclenche jusqu'à 15s de retry par requête (voir withRetry) — un cercle vicieux
// qui ralentissait l'app entière, pas juste la recherche en cours.
//
// Maintenant : véritable repli séquentiel. La requête prioritaire (index 0) garde
// son retry complet ; les suivantes — de simples variantes/suppositions de repli,
// voir authorVariants/buildCombinedQueries — n'en ont pas besoin (retries: 0,
// boost503: false) puisqu'on abandonne vite pour tenter la suivante plutôt que
// d'insister sur un repli qui n'est de toute façon qu'une supposition. Dans le cas
// courant (la requête prioritaire trouve le livre), une seule requête part au lieu
// de N — les autres ne sont même pas tentées.
// export : réutilisée aussi par bookRequestController.js (getMetadataCandidates)
// pour bénéficier du même retry/repli proxy que la recherche standard, plutôt
// que de dupliquer une version plus fragile sans ces protections.
export async function firstNonEmptyGoogleResult(queries, limit, startIndex, options) {
  for (let i = 0; i < queries.length; i++) {
    try {
      const result = await fetchFromGoogle(queries[i], limit, startIndex, {
        ...options,
        ...(i > 0 && { retries: 0, boost503: false }),
      });
      if (result.items.length > 0) return result;
    } catch (err) {
      console.warn(`[Books] Requête "${queries[i]}" échouée:`, err.message);
    }
  }
  return { items: [], totalItems: 0 };
}

// ─── Hardcover fallback (entre Google Books et Open Library) ─────────────────

const HARDCOVER_TIMEOUT = 8000;

function normalizeHardcoverDocument(doc) {
  const cover = doc.image?.url || null;
  return {
    id: `hc-${doc.id}`,
    volumeInfo: {
      title:         doc.title || '',
      authors:       (doc.author_names || []).filter(Boolean),
      publishedDate: doc.release_year ? String(doc.release_year) : '',
      description:   doc.description || 'Aucune description disponible',
      pageCount:     doc.pages || 0,
      categories:    [],
      imageLinks:    { thumbnail: cover, smallThumbnail: cover },
      language:      'fr',
      previewLink:   doc.slug ? `https://hardcover.app/books/${doc.slug}` : '',
      infoLink:      doc.slug ? `https://hardcover.app/books/${doc.slug}` : '',
      seriesInfo:    null,
      communityRating:      doc.rating || null,
      communityRatingsCount: doc.ratings_count || null,
    },
  };
}

// Recherche via l'API GraphQL Hardcover (search plein texte, backée par Typesense côté Hardcover).
async function fetchFromHardcoverSearch(q, limit) {
  const apiKey = await getHardcoverApiKey();
  if (!apiKey) return [];
  if (!takeHardcoverQuota()) {
    console.warn('[Books] Hardcover quota (60 req/min) atteint, appel ignoré');
    return [];
  }

  return withRetry(async () => {
    const res = await axiosPostWithProxy(
      'https://api.hardcover.app/v1/graphql',
      {
        query: `query Search($query: String!, $perPage: Int!) {
          search(query: $query, query_type: "Book", per_page: $perPage, page: 1) {
            results
          }
        }`,
        variables: { query: q, perPage: limit },
      },
      {
        timeout: HARDCOVER_TIMEOUT,
        headers: {
          'Content-Type': 'application/json',
          Authorization: apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`,
        },
      },
      `Hardcover search "${q}"`
    );
    if (res.data?.errors) {
      throw new Error(res.data.errors[0]?.message || 'Erreur Hardcover');
    }
    const hits = res.data?.data?.search?.results?.hits || [];
    return hits.map(h => h.document).filter(Boolean).map(normalizeHardcoverDocument);
  }, { label: `Hardcover search "${q}"` });
}

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

// Open Library recommande un User-Agent descriptif ; sans ça leur CDN peut
// couper la connexion (socket hang up) au lieu de répondre proprement.
const OPENLIBRARY_HEADERS = { 'User-Agent': 'EbookRequest/1.0 (self-hosted; +https://github.com/zlimteck)' };
// Open Library répond parfois en 8-10s même en cas normal : un timeout trop court
// empêche de détecter un vrai 503 et court-circuite le backoff dédié.
const OPENLIBRARY_TIMEOUT = 15000;

async function fetchFromOpenLibraryISBN(isbn) {
  return withRetry(async () => {
    const res = await axiosGetWithProxy('https://openlibrary.org/api/books', {
      params: { bibkeys: `ISBN:${isbn}`, format: 'json', jscmd: 'data' },
      timeout: OPENLIBRARY_TIMEOUT,
      headers: OPENLIBRARY_HEADERS,
    }, `OpenLibrary ISBN "${isbn}"`);
    const data = res.data[`ISBN:${isbn}`];
    return data ? normalizeOpenLibraryISBN(data, isbn) : null;
  }, { label: `OpenLibrary ISBN "${isbn}"` });
}

async function fetchFromOpenLibrarySearch(q, limit) {
  return withRetry(async () => {
    const res = await axiosGetWithProxy('https://openlibrary.org/search.json', {
      params: {
        q,
        limit,
        fields: 'key,title,author_name,cover_i,first_publish_year,number_of_pages_median',
      },
      timeout: OPENLIBRARY_TIMEOUT,
      headers: OPENLIBRARY_HEADERS,
    }, `OpenLibrary search "${q}"`);
    return (res.data.docs || []).map(normalizeOpenLibrarySearch);
  }, { label: `OpenLibrary search "${q}"` });
}

async function fetchFromOpenLibraryAuthor(author, limit = 40) {
  const variants = authorVariants(author);
  for (const v of variants) {
    try {
      const docs = await withRetry(async () => {
        const res = await axiosGetWithProxy('https://openlibrary.org/search.json', {
          params: {
            author: v,
            language: 'fre',
            limit,
            fields: 'key,title,author_name,cover_i,first_publish_year,number_of_pages_median,language',
          },
          timeout: OPENLIBRARY_TIMEOUT,
          headers: OPENLIBRARY_HEADERS,
        }, `OpenLibrary author "${v}"`);
        return res.data.docs || [];
      }, { label: `OpenLibrary author "${v}"` });
      if (docs.length > 0) return docs.map(normalizeOpenLibrarySearch);
    } catch (err) {
      console.warn(`[Books] OpenLibrary author "${v}" échoué après retries:`, err.message);
    }
  }
  return [];
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
        communityRating:       book.volumeInfo.communityRating       || null,
        communityRatingsCount: book.volumeInfo.communityRatingsCount || null,
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

// Mots-clés qui signalent que ce n'est PAS un tome individuel/la série elle-meme
// (patch) : coffret/integrale RETIRES de cette liste — l'utilisateur les
// veut au contraire mis en avant (un seul fichier au lieu de N, economise
// des credits de telechargement sur Valentine). Seuls les a-cotes qui ne
// sont pas vraiment "un livre de la serie" restent exclus (analyses,
// guides, etc.).
const SERIES_EXCLUDE_PATTERNS = [
  /analyse\s+de\s+l['']oeuvre/i, /fiche\s+de\s+lecture/i,
  /décrypt/i, /decrypt/i, /guide\s+(de|du|des)/i, /companion/i,
  /encyclop/i, /making\s+of/i, /\bcomics?\b/i,
];

// Recherche des autres tomes d'une série
router.get('/series-tomes', async (req, res) => {
  try {
    const { name, excludeId } = req.query;
    if (!name) return res.status(400).json({ error: 'Nom de série requis' });

    let rawItems = [];

    if (await isGoogleBooksSearchEnabled()) {
      // Tenter plusieurs stratégies de requête, fusionner et dédupliquer
      const queries = [
        `intitle:"${name}" tome`,
        `intitle:"${name}"`,
        name,
      ];

      const seen = new Set();
      const settled = await Promise.allSettled(queries.map(q => fetchFromGoogle(q, 40, 0)));
      for (const s of settled) {
        if (s.status !== 'fulfilled') continue;
        for (const item of s.value.items) {
          if (!seen.has(item.id)) {
            seen.add(item.id);
            rawItems.push(item);
          }
        }
      }
    }

    // Repli Hardcover puis Open Library si Google Books est désactivé/ne trouve rien
    if (rawItems.length === 0) {
      try {
        rawItems = await fetchFromHardcoverSearch(name, 40);
      } catch (hcErr) {
        console.warn('[Books] Hardcover fallback series-tomes échoué:', hcErr.message);
      }
    }
    if (rawItems.length === 0) {
      try {
        rawItems = await fetchFromOpenLibrarySearch(name, 40);
      } catch (olErr) {
        console.warn('[Books] Open Library fallback series-tomes échoué:', olErr.message);
      }
    }

    // Filtrer : exclure le livre actuel, coffrets, analyses, hors-série
    const nameLC = name.toLowerCase();
    const filtered = rawItems.filter(b => {
      if (b.id === excludeId) return false;
      const title = (b.volumeInfo?.title || '').toLowerCase();
      if (!title.includes(nameLC)) return false;
      if (SERIES_EXCLUDE_PATTERNS.some(p => p.test(b.volumeInfo?.title || ''))) return false;
      // NB (patch) : l'ancien filtre excluait aussi les titres contenant ";"
      // (souvent des coffrets multi-volumes) — retire aussi, meme logique
      // que ci-dessus : les coffrets/integrales sont desormais les bienvenus.
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
    const { q, author, combined, strictTitle, maxResults = 10, startIndex = 0 } = req.query;

    if (!q && !author) {
      return res.status(400).json({ message: 'Un titre ou un auteur est requis' });
    }

    const limit  = Math.min(parseInt(maxResults) || 10, 10);
    const offset = Math.max(parseInt(startIndex)  || 0,  0);

    const googleEnabled = await isGoogleBooksSearchEnabled();

    // Pour auteur seul, la clé de cache ignore l'offset (pool complet mis en cache)
    const authorOnly = !!(author?.trim() && !q?.trim());
    // Discriminant de mode (patch) : evite qu'une meme chaine "q" tapee en
    // recherche globale et en recherche titre strict ne partagent le meme
    // cache et ne renvoient l'un a la place de l'autre.
    const searchModeKey = (q?.trim() && author?.trim()) ? 'both'
      : authorOnly ? 'author'
      : combined === 'true' ? 'combined'
      : strictTitle === 'true' ? 'strict'
      : 'default';
    const cacheKey   = authorOnly
      ? getCacheKey(q, author, 'pool', 0, 40, googleEnabled, searchModeKey)
      : getCacheKey(q, author, '', offset, limit, googleEnabled, searchModeKey);

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
      const variants = authorVariants(author.trim());
      queries = [
        ...variants.map(v => `inauthor:"${v}"`),
        ...variants,
      ];
    } else if (combined === 'true' && q?.trim()) {
      queries = buildCombinedQueries(q);
    } else if (strictTitle === 'true' && q?.trim()) {
      // Recherche titre STRICT (patch) : contrairement au mode "global" et au
      // chemin par defaut (buildQueries), qui envoient la chaine brute sans
      // restriction de champ, ici on force Google Books a ne matcher que sur
      // le champ titre via l'operateur intitle:.
      const clean = q.trim();
      const isbnClean = clean.replace(/[-\s]/g, '');
      queries = (/^\d{10}$/.test(isbnClean) || /^\d{13}$/.test(isbnClean))
        ? [`isbn:${isbnClean}`]
        : [`intitle:"${clean}"`];
    } else {
      queries = buildQueries(q);
    }

    let rawItems   = [];
    let totalItems = 0;

    if (authorOnly) {
      let pool = [];
      if (googleEnabled) {
        const result = await firstNonEmptyGoogleResult(queries, 40, 0, { langRestrict: 'fr' });
        pool = result.items.filter(item =>
          !item.volumeInfo?.language || item.volumeInfo.language === 'fr'
        );
      }
      // Fallback Hardcover puis Open Library si Google Books est désactivé/ne trouve rien en français
      if (pool.length === 0) {
        try {
          pool = await fetchFromHardcoverSearch(author.trim(), 40);
        } catch (hcErr) {
          console.warn('[Books] Hardcover fallback auteur échoué:', hcErr.message);
        }
      }
      if (pool.length === 0) {
        pool = await fetchFromOpenLibraryAuthor(author.trim());
      }
      pool.sort((a, b) => {
        const yearA = parseInt((a.volumeInfo?.publishedDate || '').slice(0, 4)) || 0;
        const yearB = parseInt((b.volumeInfo?.publishedDate || '').slice(0, 4)) || 0;
        return yearB - yearA;
      });
      // Mettre le pool en cache (format spécifique)
      searchCache.set(cacheKey, { data: { pool }, expiresAt: Date.now() + CACHE_TTL_MS });
      rawItems   = pool.slice(offset, offset + limit);
      totalItems = pool.length;
    } else if (googleEnabled) {
      const result = await firstNonEmptyGoogleResult(queries, limit, offset);
      rawItems   = result.items;
      totalItems = result.totalItems;
      // Fallback titre brut si aucun résultat structuré (page 1 seulement)
      if (rawItems.length === 0 && queries.length > 1 && offset === 0 && q?.trim()) {
        const result = await fetchFromGoogle(q.trim(), limit, 0);
        rawItems   = result.items;
        totalItems = result.totalItems;
      }
    }

    // ── Fallback Hardcover puis Open Library si Google Books n'a rien trouvé (page 1) ─
    if (rawItems.length === 0 && offset === 0 && !authorOnly) {
      const isbnClean = (q || '').trim().replace(/[-\s]/g, '');
      const isISBN = /^\d{10}$/.test(isbnClean) || /^\d{13}$/.test(isbnClean);

      if (q?.trim()) {
        try {
          const hcResults = await fetchFromHardcoverSearch(q.trim(), limit);
          if (hcResults.length > 0) {
            console.log(`[Books] Hardcover fallback → ${hcResults.length} résultat(s)`);
            return res.json({ results: hcResults, totalItems: hcResults.length });
          }
        } catch (hcErr) {
          console.warn('[Books] Hardcover fallback échoué:', hcErr.message);
        }
      }

      try {
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
    console.error(`Erreur lors de la recherche Google Books (q="${req.query.q || ''}", author="${req.query.author || ''}"):`, error.message);

    // Si rate limit (429) ou service indisponible (503), retourner cache expiré si dispo
    if (error.response?.status === 429 || error.response?.status === 503) {
      const limit       = Math.min(parseInt(req.query.maxResults || 10), 10);
      const offset       = Math.max(parseInt(req.query.startIndex) || 0, 0);
      const authorOnlyErr = !!(req.query.author?.trim() && !req.query.q?.trim());
      const googleEnabledErr = await isGoogleBooksSearchEnabled();
      const searchModeKeyErr = (req.query.q?.trim() && req.query.author?.trim()) ? 'both'
        : authorOnlyErr ? 'author'
        : req.query.combined === 'true' ? 'combined'
        : req.query.strictTitle === 'true' ? 'strict'
        : 'default';
      const cacheKey      = authorOnlyErr
        ? getCacheKey(req.query.q, req.query.author, 'pool', 0, 40, googleEnabledErr, searchModeKeyErr)
        : getCacheKey(req.query.q, req.query.author, '', offset, limit, googleEnabledErr, searchModeKeyErr);
      const stale = searchCache.get(cacheKey);
      if (stale) {
        if (authorOnlyErr) {
          const pool = stale.data.pool;
          return res.json({ results: formatPool(pool.slice(offset, offset + limit)), totalItems: pool.length });
        }
        return res.json(stale.data);
      }

      // Pas de cache disponible : tenter Hardcover puis Open Library en dernier recours
      // avant d'abandonner (Google Books indisponible pour cette IP).
      try {
        if (authorOnlyErr) {
          const hcPool = await fetchFromHardcoverSearch(req.query.author.trim(), 40);
          if (hcPool.length > 0) {
            console.log(`[Books] Hardcover fallback (503/429) auteur → ${hcPool.length} résultat(s)`);
            return res.json({ results: hcPool.slice(offset, offset + limit), totalItems: hcPool.length });
          }
        } else if (req.query.q?.trim()) {
          const hcResults = await fetchFromHardcoverSearch(req.query.q.trim(), limit);
          if (hcResults.length > 0) {
            console.log(`[Books] Hardcover fallback (503/429) → ${hcResults.length} résultat(s)`);
            return res.json({ results: hcResults, totalItems: hcResults.length });
          }
        }
      } catch (hcErr) {
        console.warn('[Books] Hardcover fallback (503/429) échoué:', hcErr.message);
      }

      try {
        if (authorOnlyErr) {
          const pool = await fetchFromOpenLibraryAuthor(req.query.author.trim());
          if (pool.length > 0) {
            console.log(`[Books] Open Library fallback (503/429) auteur → ${pool.length} résultat(s)`);
            return res.json({ results: formatPool(pool.slice(offset, offset + limit)), totalItems: pool.length });
          }
        } else if (req.query.q?.trim()) {
          const olResults = await fetchFromOpenLibrarySearch(req.query.q.trim(), limit);
          if (olResults.length > 0) {
            console.log(`[Books] Open Library fallback (503/429) → ${olResults.length} résultat(s)`);
            return res.json({ results: olResults, totalItems: olResults.length });
          }
        }
      } catch (olErr) {
        console.warn('[Books] Open Library fallback (503/429) échoué:', olErr.message);
      }
    }

    res.status(500).json({
      message: 'Erreur lors de la recherche de livres',
      error: error.message,
    });
  }
});

export default router;
