import axios from 'axios';
import { enrichAuthorFromHardcover } from './hardcoverAuthorService.js';

// Source principale de l'identité des auteurs (issue #48) : gratuite, sans clé
// API, et fournit une clé stable (OL123A) qui ne dépend jamais du nom seul
// (contrairement à une recherche par nom, fragile face aux homonymes).
const HEADERS = { 'User-Agent': 'EbookRequest/1.0 (self-hosted; +https://github.com/zlimteck)' };
const TIMEOUT = 15000;

// Cache mémoire par clé Open Library — pas sur la recherche (requêtes trop
// variées pour qu'un cache serve à quelque chose). `getAuthorDetails`
// (bio/photo, change rarement) a un TTL long ; `getAuthorWorks` (aussi
// appelée par authorReleaseCron.js, qui tourne une fois par jour) un TTL
// plus court pour que le cron voie toujours une bibliographie récente sans
// jamais être bloqué plus d'une heure par une réponse mise en cache.
const DETAILS_TTL_MS = 24 * 60 * 60 * 1000;
const WORKS_TTL_MS = 60 * 60 * 1000;
const detailsCache = new Map();
const worksCache = new Map();

function getCached(cache, key) {
  const entry = cache.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.value;
  cache.delete(key);
  return null;
}

function setCached(cache, key, value, ttlMs) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function stripOlPrefix(key) {
  return (key || '').replace(/^\/authors\//, '');
}

// Les bios Open Library gardent parfois la syntaxe Markdown brute des wikis
// qui les ont fournies : liens de référence "[texte][1]" renvoyant à un bloc
// de définitions "[1]: https://...", jamais rendus par l'app (texte affiché
// tel quel). Normalisé ici une fois pour toutes plutôt que dans chaque
// composant qui affiche une bio.
function cleanBio(bio) {
  if (!bio) return '';
  return bio
    // Bloc de définitions de référence ("[1]: https://...") en fin de texte.
    .replace(/^\s*\[\d+\]:\s*\S+\s*$/gm, '')
    // "[texte][1]" → "texte" (lien de référence Markdown).
    .replace(/\[([^\]]+)\]\[\d+\]/g, '$1')
    // "[texte](url)" → "texte" (lien inline Markdown, au cas où).
    .replace(/\[([^\]]+)\]\(https?:\/\/[^\)]+\)/g, '$1')
    // Effondre les lignes vides laissées par les suppressions ci-dessus.
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Open Library indexe le nom tel qu'il apparaît dans la source catalographique
// qu'il a ingérée, souvent la langue d'origine pour un auteur de manga/manhwa
// (ex. "尾田栄一郎" plutôt que "Eiichiro Oda") — sans préférence automatique
// pour une version latine, alors que `alternate_names` en contient
// généralement une. Un test réel sur "Eiichiro Oda" (OL2733294A) confirme
// que l'alternative latine existe bien dans cette liste, juste jamais
// utilisée comme `name` principal par l'API elle-même.
const LATIN_RE = /^[\x00-\x7FÀ-ɏḀ-ỿ\s.,'’-]+$/;

export function isLatinScript(str) {
  return !!str && LATIN_RE.test(str);
}

/** Préfère un nom en alphabet latin s'il en existe un parmi les alternatives. */
function pickBestName(name, alternateNames = []) {
  if (isLatinScript(name)) return name;
  const latinAlt = alternateNames.find(isLatinScript);
  return latinAlt || name;
}

/** Recherche d'auteurs par nom, limitée pour ne pas multiplier les appels par recherche. */
export async function searchAuthors(query, limit = 8) {
  const res = await axios.get('https://openlibrary.org/search/authors.json', {
    params: { q: query, limit },
    timeout: TIMEOUT,
    headers: HEADERS,
  });
  return (res.data.docs || []).map(doc => ({
    openLibraryKey: doc.key,
    name: pickBestName(doc.name, doc.alternate_names || []),
    topWork: doc.top_work || '',
    workCount: doc.work_count || 0,
    photoUrl: `https://covers.openlibrary.org/a/olid/${doc.key}-M.jpg`,
  }));
}

/**
 * Détails d'un auteur (bio) — appel séparé de la recherche, à ne faire que
 * pour un auteur précis (ex. après sélection), pas pour chaque résultat d'une
 * recherche. Si Open Library ne fournit aucun nom/alternative en alphabet
 * latin, complète via Hardcover (optionnel, si activé par l'admin) plutôt que
 * de laisser le nom d'origine s'afficher partout dans l'app.
 */
export async function getAuthorDetails(openLibraryKey) {
  const key = stripOlPrefix(openLibraryKey);
  const cached = getCached(detailsCache, key);
  if (cached) return cached;

  const res = await axios.get(`https://openlibrary.org/authors/${key}.json`, {
    timeout: TIMEOUT,
    headers: HEADERS,
  });
  const bio = cleanBio(typeof res.data.bio === 'string' ? res.data.bio : (res.data.bio?.value || ''));
  const rawName = res.data.name || '';
  let name = pickBestName(rawName, res.data.alternate_names || []);
  let finalBio = bio;
  let photoUrl = `https://covers.openlibrary.org/a/olid/${key}-M.jpg`;

  if (!isLatinScript(name)) {
    const enrichment = await enrichAuthorFromHardcover(rawName).catch(() => null);
    if (enrichment) {
      const hcName = pickBestName(enrichment.name, enrichment.alternateNames);
      if (isLatinScript(hcName)) name = hcName;
      if (!finalBio && enrichment.bio) finalBio = cleanBio(enrichment.bio);
      if (enrichment.photoUrl) photoUrl = enrichment.photoUrl;
    }
  }

  const result = { openLibraryKey: key, name, bio: finalBio, photoUrl };
  setCached(detailsCache, key, result, DETAILS_TTL_MS);
  return result;
}

/**
 * Liste des œuvres d'un auteur, triée par date de sortie la plus récente
 * d'abord — utilisée à la fois pour "tous les livres de l'auteur" et pour la
 * détection de nouveauté par authorReleaseCron.js (comparaison par clé d'œuvre
 * ET par date, jamais par nom).
 */
export async function getAuthorWorks(openLibraryKey, limit = 50) {
  const key = stripOlPrefix(openLibraryKey);
  const cacheKey = `${key}:${limit}`;
  const cached = getCached(worksCache, cacheKey);
  if (cached) return cached;

  const res = await axios.get(`https://openlibrary.org/authors/${key}/works.json`, {
    params: { limit },
    timeout: TIMEOUT,
    headers: HEADERS,
  });
  const works = (res.data.entries || []).map(entry => ({
    workKey: entry.key,
    title: entry.title || 'Titre inconnu',
    firstPublishDate: entry.first_publish_date || '',
    coverId: entry.covers?.[0] || null,
    coverUrl: entry.covers?.[0] ? `https://covers.openlibrary.org/b/id/${entry.covers[0]}-M.jpg` : '',
  })).sort((a, b) => (b.firstPublishDate || '').localeCompare(a.firstPublishDate || ''));

  setCached(worksCache, cacheKey, works, WORKS_TTL_MS);
  return works;
}
