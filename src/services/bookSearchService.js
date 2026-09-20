import axios from 'axios';
import { getGoogleBooksApiKey, isGoogleBooksSearchEnabled } from './googleBooksConfig.js';
import { getHardcoverApiKey, takeHardcoverQuota } from './hardcoverConfig.js';
import { getProxyConfig, getProxyAgent } from './proxyConfig.js';

// Service partagé de recherche de métadonnées livre, utilisé par les consommateurs
// qui ont juste besoin "du meilleur résultat" ou d'une petite liste (chatbot,
// recommandations, bestsellers, trending) — pas de pagination/cache avancé comme
// dans src/routes/googleBooks.js (la route garde sa propre implémentation, plus
// riche, pour ne pas risquer de régression sur la recherche principale).
// Même ordre de repli : Google Books → Hardcover → Open Library.

async function axiosGetWithProxy(url, axiosOptions, label) {
  const proxy = await getProxyConfig();
  const direct = () => axios.get(url, axiosOptions);
  const viaProxy = () => axios.get(url, { ...axiosOptions, httpsAgent: getProxyAgent(proxy.url), proxy: false });
  if (!proxy.enabled) return direct();
  const [first, second] = proxy.mode === 'default' ? [viaProxy, direct] : [direct, viaProxy];
  try {
    return await first();
  } catch (err) {
    console.warn(`[BookSearch] ${label} échec, repli proxy/direct (${err.response?.status || err.code || err.message})`);
    return second();
  }
}

async function axiosPostWithProxy(url, body, axiosOptions, label) {
  const proxy = await getProxyConfig();
  const direct = () => axios.post(url, body, axiosOptions);
  const viaProxy = () => axios.post(url, body, { ...axiosOptions, httpsAgent: getProxyAgent(proxy.url), proxy: false });
  if (!proxy.enabled) return direct();
  const [first, second] = proxy.mode === 'default' ? [viaProxy, direct] : [direct, viaProxy];
  try {
    return await first();
  } catch (err) {
    console.warn(`[BookSearch] ${label} échec, repli proxy/direct (${err.response?.status || err.code || err.message})`);
    return second();
  }
}

async function fetchFromGoogle(queryStr, limit, options = {}) {
  const apiKey = await getGoogleBooksApiKey();
  const response = await axiosGetWithProxy(
    'https://www.googleapis.com/books/v1/volumes',
    {
      params: {
        q: queryStr, maxResults: limit, key: apiKey, printType: 'books',
        ...(options.langRestrict && { langRestrict: options.langRestrict }),
      },
      timeout: 8000,
    },
    `Google Books "${queryStr}"`
  );
  return response.data.items || [];
}

function normalizeHardcoverDocument(doc) {
  const cover = doc.image?.url || null;
  return {
    id: `hc-${doc.id}`,
    volumeInfo: {
      title: doc.title || '',
      authors: (doc.author_names || []).filter(Boolean),
      publishedDate: doc.release_year ? String(doc.release_year) : '',
      description: doc.description || null,
      pageCount: doc.pages || 0,
      language: 'fr',
      imageLinks: { thumbnail: cover },
      previewLink: doc.slug ? `https://hardcover.app/books/${doc.slug}` : null,
      infoLink: doc.slug ? `https://hardcover.app/books/${doc.slug}` : null,
      communityRating: doc.rating || null,
      communityRatingsCount: doc.ratings_count || null,
    },
  };
}

async function fetchFromHardcoverSearch(q, limit) {
  const apiKey = await getHardcoverApiKey();
  if (!apiKey) return [];
  if (!takeHardcoverQuota()) {
    console.warn('[BookSearch] Hardcover quota (60 req/min) atteint, appel ignoré');
    return [];
  }
  const res = await axiosPostWithProxy(
    'https://api.hardcover.app/v1/graphql',
    {
      query: `query Search($query: String!, $perPage: Int!) {
        search(query: $query, query_type: "Book", per_page: $perPage, page: 1) { results }
      }`,
      variables: { query: q, perPage: limit },
    },
    {
      timeout: 8000,
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`,
      },
    },
    `Hardcover search "${q}"`
  );
  if (res.data?.errors) throw new Error(res.data.errors[0]?.message || 'Erreur Hardcover');
  const hits = res.data?.data?.search?.results?.hits || [];
  return hits.map(h => h.document).filter(Boolean).map(normalizeHardcoverDocument);
}

const OPENLIBRARY_HEADERS = { 'User-Agent': 'EbookRequest/1.0 (self-hosted; +https://github.com/zlimteck)' };

function normalizeOpenLibrarySearch(doc) {
  const coverUrl = doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null;
  const key = (doc.key || '').replace('/works/', '');
  return {
    id: `ol-${key || Math.random().toString(36).slice(2)}`,
    volumeInfo: {
      title: doc.title || '',
      authors: doc.author_name || [],
      publishedDate: doc.first_publish_year ? String(doc.first_publish_year) : '',
      description: null,
      pageCount: doc.number_of_pages_median || 0,
      language: 'fr',
      imageLinks: { thumbnail: coverUrl },
      previewLink: `https://openlibrary.org${doc.key || ''}`,
      infoLink: `https://openlibrary.org${doc.key || ''}`,
    },
  };
}

async function fetchFromOpenLibrarySearch(q, limit) {
  const res = await axiosGetWithProxy('https://openlibrary.org/search.json', {
    params: { q, limit, fields: 'key,title,author_name,cover_i,first_publish_year,number_of_pages_median' },
    timeout: 15000,
    headers: OPENLIBRARY_HEADERS,
  }, `OpenLibrary search "${q}"`);
  return (res.data.docs || []).map(normalizeOpenLibrarySearch);
}

function normalizeMatch(vi, id, source) {
  return {
    id,
    source,
    title: vi.title || '',
    authors: vi.authors || [],
    author: vi.authors?.[0] || null,
    description: vi.description || null,
    pageCount: vi.pageCount || 0,
    publishedDate: vi.publishedDate || null,
    language: vi.language || 'fr',
    thumbnail: vi.imageLinks?.thumbnail ? vi.imageLinks.thumbnail.replace(/^http:\/\//, 'https://') : null,
    link: vi.previewLink || vi.infoLink || null,
    communityRating: vi.communityRating || null,
    communityRatingsCount: vi.communityRatingsCount || null,
  };
}

/**
 * Meilleur résultat unique pour un titre (+auteur optionnel), avec repli
 * Google Books → Hardcover → Open Library. Retourne `null` si rien trouvé.
 */
export async function findBestBookMatch({ title, author = '' }) {
  const t = (title || '').trim();
  if (!t) return null;
  const a = (author || '').trim();

  // Une source peut confirmer qu'un livre existe sans avoir de couverture pour
  // autant (fréquent sur Google Books selon l'édition) — on garde ce premier
  // résultat en repli, mais on continue d'interroger les sources suivantes
  // tant qu'aucune couverture n'a été trouvée, plutôt que de s'arrêter au
  // premier match sans image.
  let fallback = null;

  if (await isGoogleBooksSearchEnabled()) {
    try {
      const query = a ? `intitle:"${t}" inauthor:"${a}"` : `intitle:"${t}"`;
      const items = await fetchFromGoogle(query, 1);
      if (items[0]) {
        const match = normalizeMatch(items[0].volumeInfo, items[0].id, 'google');
        if (match.thumbnail) return match;
        fallback = fallback || match;
      }
    } catch (err) {
      console.warn(`[BookSearch] Google Books échoué pour "${t}":`, err.message);
    }
  }

  try {
    const hc = await fetchFromHardcoverSearch(a ? `${t} ${a}` : t, 1);
    if (hc[0]) {
      const match = normalizeMatch(hc[0].volumeInfo, hc[0].id, 'hardcover');
      if (match.thumbnail) return match;
      fallback = fallback || match;
    }
  } catch (err) {
    console.warn(`[BookSearch] Hardcover échoué pour "${t}":`, err.message);
  }

  try {
    const ol = await fetchFromOpenLibrarySearch(a ? `${t} ${a}` : t, 1);
    if (ol[0]) {
      const match = normalizeMatch(ol[0].volumeInfo, ol[0].id, 'openlibrary');
      if (match.thumbnail) return match;
      fallback = fallback || match;
    }
  } catch (err) {
    console.warn(`[BookSearch] Open Library échoué pour "${t}":`, err.message);
  }

  return fallback;
}

/**
 * Petite liste de résultats pour une requête libre (titre/auteur mélangés),
 * même ordre de repli que `findBestBookMatch`.
 */
export async function searchBooksList(query, limit = 5) {
  const q = (query || '').trim();
  if (!q) return [];

  if (await isGoogleBooksSearchEnabled()) {
    try {
      const items = await fetchFromGoogle(q, limit, { langRestrict: 'fr' });
      if (items.length) return items.map(it => normalizeMatch(it.volumeInfo, it.id, 'google'));
    } catch (err) {
      console.warn(`[BookSearch] Google Books liste échouée pour "${q}":`, err.message);
    }
  }

  try {
    const hc = await fetchFromHardcoverSearch(q, limit);
    if (hc.length) return hc.map(b => normalizeMatch(b.volumeInfo, b.id, 'hardcover'));
  } catch (err) {
    console.warn(`[BookSearch] Hardcover liste échouée pour "${q}":`, err.message);
  }

  try {
    const ol = await fetchFromOpenLibrarySearch(q, limit);
    return ol.map(b => normalizeMatch(b.volumeInfo, b.id, 'openlibrary'));
  } catch (err) {
    console.warn(`[BookSearch] Open Library liste échouée pour "${q}":`, err.message);
    return [];
  }
}
