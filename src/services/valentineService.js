import axios from 'axios';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import ConnectorSettings from '../models/ConnectorSettings.js';
import BookRequest from '../models/BookRequest.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { sendBookCompletedEmail } from './emailService.js';
import { sendPushToUser } from './webPushService.js';
import { runPostCompletionHooks } from './postCompletionHooks.js';
import { decrypt } from './cryptoService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_URL = 'https://valentine.wtf';

// Le texte brut renvoyé par Valentine (titres, auteurs, séries) contient
// parfois du HTML littéral (ex: "<i>(contenu dans: ...)</i>" sur les revues) —
// jamais interprété/rendu par notre front (pas de dangerouslySetInnerHTML),
// donc affiché tel quel comme texte. On le nettoie à la source.
function stripTags(str) {
  return (str || '').replace(/<[^>]+>/g, '').trim();
}

// ─── Helpers de matching ───────────────────────────────────────────────────────

function normalizeForMatch(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // supprimer les accents
    .replace(/[.,'"""'']/g, ' ')       // ponctuation → espace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Retourne un score 0–1 : proportion des tokens de requestAuthor présents dans resultAuthor.
 * Retourne 1 si aucun auteur n'est fourni (pas de contrainte).
 */
function authorMatchScore(requestAuthor, resultAuthor) {
  if (!requestAuthor) return 1;
  const reqTokens = normalizeForMatch(requestAuthor).split(' ').filter(t => t.length > 1);
  if (!reqTokens.length) return 1;
  if (!resultAuthor) return 0;
  const resTokens = normalizeForMatch(resultAuthor).split(' ').filter(t => t.length > 1);
  let matches = 0;
  for (const rw of reqTokens) {
    if (resTokens.some(w => w === rw || w.startsWith(rw) || rw.startsWith(w))) matches++;
  }
  return matches / reqTokens.length;
}

/**
 * Extrait le numéro de volume/tome d'un titre (T01, T15, Vol. 3, Vol.3, #3…).
 * Retourne null si aucun numéro trouvé.
 */
function extractVolumeNumber(title) {
  const m = normalizeForMatch(title).match(
    /(?:^|\s)(?:t|tome|vol\.?|volume|#)\s*(\d{1,3})(?:\s|$)/i
  );
  return m ? parseInt(m[1], 10) : null;
}

// Profils navigateur cohérents — UA + jeu de headers assortis, tirés
// ENSEMBLE (pas mélangés au hasard). Un vrai Firefox n'envoie jamais les
// headers Sec-Ch-Ua que Chrome envoie, et inversement ; envoyer un UA Firefox
// avec des headers Chrome (ou aucun header caractéristique) est une
// incohérence trivialement repérable par un WAF un peu sérieux.
// NB : pas de 'zstd' dans Accept-Encoding même si le vrai Chrome récent
// l'annonce — si le serveur nous répond effectivement en zstd, on ne serait
// pas garantis de pouvoir le décompresser correctement selon la version de
// Node, donc on reste sur gzip/deflate/br (fiables) plutôt que sur l'exactitude
// parfaite du fingerprint.
// Limite assumée : ça ne couvre que les headers HTTP. Le fingerprint TLS d'un
// client Node reste différent de celui d'un vrai navigateur quels que soient
// les headers envoyés par-dessus — pas quelque chose qu'on corrige ici.
const BROWSER_PROFILES = [
  {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:124.0) Gecko/20100101 Firefox/124.0',
    headers: {
      'Accept-Language': 'fr-FR,fr;q=0.8,en-US;q=0.5,en;q=0.3',
      'Accept-Encoding': 'gzip, deflate, br',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'Connection': 'keep-alive',
    },
  },
  {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    headers: {
      'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Connection': 'keep-alive',
    },
  },
  {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    headers: {
      'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Ch-Ua': '"Chromium";v="123", "Not:A-Brand";v="8"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Linux"',
      'Connection': 'keep-alive',
    },
  },
  {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    headers: {
      // Safari n'envoie ni Sec-Fetch-* de façon fiable ni de Client Hints (Sec-Ch-Ua*)
      'Accept-Language': 'fr-FR,fr;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
    },
  },
];

function pickBrowserProfile() {
  return BROWSER_PROFILES[Math.floor(Math.random() * BROWSER_PROFILES.length)];
}

function baseHeaders() {
  const profile = pickBrowserProfile();
  return {
    'User-Agent': profile.userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    ...profile.headers,
  };
}

// ─── Détection de blocage (rate-limit / CAPTCHA / WAF) ─────────────────────────

const CAPTCHA_MARKERS = [
  /captcha/i,
  /cloudflare/i,
  /checking your browser/i,
  /attention required/i,
  /access denied/i,
  /just a moment/i,
];

function detectBlock(status, html) {
  if (status === 403 || status === 429 || status === 503) return `HTTP ${status}`;
  if (typeof html === 'string' && html.length < 5000) {
    for (const pattern of CAPTCHA_MARKERS) {
      if (pattern.test(html)) return `contenu suspect (${pattern})`;
    }
  }
  return null;
}

class ValentineBlockedError extends Error {
  constructor(reason) {
    super(`Valentine semble bloquer les requêtes : ${reason}`);
    this.name = 'ValentineBlockedError';
    this.isBlock = true;
  }
}

// ─── Circuit breaker ────────────────────────────────────────────────────────────

let consecutiveBlocks = 0;
let blockedUntil = null;
let lastBlockReason = null;
let lastBlockAt = null;
const BLOCK_THRESHOLD = 3;
const BLOCK_PAUSE_MS = 60 * 60 * 1000; // 1h de pause après détection répétée

function isCircuitOpen() {
  return blockedUntil !== null && Date.now() < blockedUntil;
}

function recordBlock(reason) {
  consecutiveBlocks++;
  lastBlockReason = reason;
  lastBlockAt = new Date();
  console.warn(`[Valentine] Blocage détecté (${reason}) — ${consecutiveBlocks}/${BLOCK_THRESHOLD}`);
  if (consecutiveBlocks >= BLOCK_THRESHOLD) {
    blockedUntil = Date.now() + BLOCK_PAUSE_MS;
    console.error(`[Valentine] Circuit ouvert — connecteur mis en pause ${BLOCK_PAUSE_MS / 60000}min (blocage probable / ban).`);
    logCircuitEvent(reason).catch(() => {});
  }
}

function recordSuccess() {
  consecutiveBlocks = 0;
  blockedUntil = null;
}

function assertCircuitClosed() {
  if (isCircuitOpen()) {
    const remainingMin = Math.ceil((blockedUntil - Date.now()) / 60000);
    throw new ValentineBlockedError(`connecteur en pause encore ${remainingMin}min suite à des blocages répétés`);
  }
}

/** État exposé à l'admin (carte Valentine du panel Services). */
export function getValentineCircuitStatus() {
  return {
    open: isCircuitOpen(),
    consecutiveBlocks,
    blockedUntil: blockedUntil ? new Date(blockedUntil).toISOString() : null,
    lastBlockReason,
    lastBlockAt,
  };
}

/** Trace l'ouverture du circuit dans les DownloadLogs pour qu'elle apparaisse dans Panel Admin / Logs. */
async function logCircuitEvent(reason) {
  const { default: DownloadLog } = await import('../models/DownloadLog.js');
  await DownloadLog.create({
    title: 'Valentine — circuit breaker ouvert',
    author: '',
    connector: 'valentine',
    success: false,
    error: `Blocage répété détecté (${reason}) — connecteur mis en pause ${BLOCK_PAUSE_MS / 60000}min`,
    triggeredBy: 'auto',
  });
}

// ─── Verrou global : sérialise tous les accès réseau vers Valentine ────────────
// Empêche le cron, une création de demande utilisateur et une recherche admin
// de taper valentine.wtf en même temps (plusieurs sessions concurrentes = signal suspect).

let lockChain = Promise.resolve();

function withValentineLock(fn) {
  const run = lockChain.then(fn, fn);
  lockChain = run.then(() => {}, () => {});
  return run;
}

// Jitter aléatoire entre chaque requête HTTP individuelle vers Valentine
function jitter(min = 800, max = 2200) {
  return new Promise(resolve => setTimeout(resolve, min + Math.random() * (max - min)));
}

async function getConfig() {
  const doc = await ConnectorSettings.findOne({ service: 'valentine' }).lean();
  if (!doc) return { enabled: false, url: DEFAULT_URL, username: '', password: '' };
  const raw = doc.password || '';
  return { ...doc, password: decrypt(raw) ?? raw }; // fallback si ancien mot de passe en clair
}

/**
 * La recherche directe (bypass Google Books) peut être désactivée par un
 * admin — champ absent sur un doc existant (avant migration) = activé, seul
 * `false` explicite désactive.
 */
export async function isDirectSearchEnabled() {
  const config = await getConfig();
  return config.directSearchEnabled !== false;
}

/** Parse Set-Cookie headers into a key/value object. */
function parseCookies(setCookieHeaders) {
  if (!setCookieHeaders) return {};
  const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  const cookies = {};
  for (const header of headers) {
    const segment = header.split(';')[0].trim();
    const eqIdx = segment.indexOf('=');
    if (eqIdx > 0) {
      cookies[segment.slice(0, eqIdx).trim()] = segment.slice(eqIdx + 1).trim();
    }
  }
  return cookies;
}

/** Format cookie object into a Cookie header string. */
function cookieHeader(cookies) {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * Login to valentine.wtf and return the session cookies.
 * @param {string} baseUrl
 * @param {string} username
 * @param {string} password
 * @returns {Promise<object>} cookies
 */
async function login(baseUrl, username, password) {
  assertCircuitClosed();
  const headers = baseHeaders();

  // 1. GET homepage to extract lsID token
  const homeRes = await axios.get(`${baseUrl}/`, {
    headers,
    timeout: 25000,
    maxRedirects: 5,
    validateStatus: () => true,
  });

  const homeBlock = detectBlock(homeRes.status, homeRes.data);
  if (homeBlock) {
    recordBlock(homeBlock);
    throw new ValentineBlockedError(homeBlock);
  }

  const lsIdMatch = homeRes.data.match(/name=["']lsID["']\s+value=["']([^"']+)["']/);
  const lsId = lsIdMatch ? lsIdMatch[1] : '';
  const cookies = parseCookies(homeRes.headers['set-cookie']);

  await jitter();

  // 2. POST credentials
  const formData = new URLSearchParams({ pseudo: username, password, lsID: lsId });
  const loginRes = await axios.post(
    `${baseUrl}/includes/login_verif.php?action=login&type=user`,
    formData.toString(),
    {
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': `${baseUrl}/`,
        'Origin': baseUrl,
        'Cookie': cookieHeader(cookies),
      },
      timeout: 25000,
      maxRedirects: 5,
      validateStatus: () => true,
    }
  );

  const loginBlock = detectBlock(loginRes.status, loginRes.data);
  if (loginBlock) {
    recordBlock(loginBlock);
    throw new ValentineBlockedError(loginBlock);
  }

  const allCookies = { ...cookies, ...parseCookies(loginRes.headers['set-cookie']) };

  if (!allCookies.hash_m) {
    throw new Error('Identifiants invalides — cookie hash_m absent (connexion refusée)');
  }

  recordSuccess();
  return allCookies;
}

// ─── Cache de session ───────────────────────────────────────────────────────
// (patch) : jusqu'ici, login() était appelé fraîchement à CHAQUE opération —
// une simple recherche, un clic sur un auteur, un téléchargement — même en
// pure navigation sans rien télécharger. Ça multipliait les logins sans
// rapport avec le volume réel d'activité, un facteur plausible dans le ban de
// compte passé (motif de requêtes non-humain). On met maintenant la session
// en cache un temps limité ; withValentineLock sérialise déjà tout, donc pas
// de risque de concurrence ici.
//
// Durée choisie prudemment — impossible de tester la vraie durée de session
// Valentine depuis cet environnement. À raccourcir si des échecs "session
// expirée silencieuse" apparaissent en pratique (résultats vides suspects
// après plusieurs minutes d'inactivité).
const SESSION_TTL_MS = 8 * 60 * 1000; // 8 minutes

let cachedSession = null; // { baseUrl, username, password, cookies, expiresAt }

async function getSession(baseUrl, username, password) {
  const now = Date.now();
  if (
    cachedSession &&
    cachedSession.baseUrl === baseUrl &&
    cachedSession.username === username &&
    cachedSession.password === password &&
    cachedSession.expiresAt > now
  ) {
    return cachedSession.cookies;
  }
  const cookies = await login(baseUrl, username, password);
  cachedSession = { baseUrl, username, password, cookies, expiresAt: now + SESSION_TTL_MS };
  return cookies;
}

/**
 * Search ebooks by title/author term.
 * @param {string} baseUrl
 * @param {object} cookies
 * @param {string} query
 * @returns {Promise<Array>} list of { id, title, url }
 */
async function searchTitles(baseUrl, cookies, query) {
  await jitter();
  const res = await axios.get(`${baseUrl}/includes/recherche.php`, {
    params: { type: 'global', term: query, contenu: 'search_ebooks' },
    headers: {
      ...baseHeaders(),
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      'Cookie': cookieHeader(cookies),
    },
    timeout: 20000,
    validateStatus: () => true,
  });

  const block = detectBlock(res.status, typeof res.data === 'string' ? res.data : null);
  if (block) {
    recordBlock(block);
    throw new ValentineBlockedError(block);
  }

  const data = Array.isArray(res.data) ? res.data : [];
  const results = [];
  for (const item of data) {
    if (!item.value || !item.id) continue;
    if (item.txt?.includes('Cliquez ici')) continue;
    // Extract author from txt field: "Titre [Author1, Author2]"
    const authorMatch = item.txt?.match(/\[([^\]]+)\]/);
    const author = authorMatch ? stripTags(authorMatch[1]) : null;
    results.push({ id: String(item.id), title: stripTags(item.value), url: item.url || '', author });
  }
  return results;
}

/**
 * Search authors by name (autocomplete endpoint, meme route que searchTitles
 * mais contenu=search_auteurs). Retourne les fiches auteur, PAS les livres —
 * confirme juste que l'auteur existe sur Valentine.
 * @returns {Promise<Array>} list of { id, name, url }
 */
async function searchAuthors(baseUrl, cookies, query) {
  await jitter();
  const res = await axios.get(`${baseUrl}/includes/recherche.php`, {
    params: { type: 'global', term: query, contenu: 'search_auteurs' },
    headers: {
      ...baseHeaders(),
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      'Cookie': cookieHeader(cookies),
    },
    timeout: 20000,
    validateStatus: () => true,
  });

  const block = detectBlock(res.status, typeof res.data === 'string' ? res.data : null);
  if (block) {
    recordBlock(block);
    throw new ValentineBlockedError(block);
  }

  const data = Array.isArray(res.data) ? res.data : [];
  const results = [];
  for (const item of data) {
    if (!item.value || !item.id) continue;
    if (item.txt?.includes('Cliquez ici')) continue;
    results.push({ id: String(item.id), name: stripTags(item.value), url: item.url || '' });
  }
  return results;
}

/**
 * Search series by name (autocomplete endpoint, meme route, contenu=search_series).
 * Retourne les fiches serie, PAS les fichiers — un second appel est necessaire
 * pour lister les tomes/integrales d'une serie (voir listSeriesFiles).
 * (patch) : expose aussi `hint`, le contenu brut du champ txt de Valentine —
 * à ce jour, contenu observé inconnu (peut-être vide, peut-être un auteur ou
 * un descriptif) ; affiché tel quel côté front si non vide, pour aider à
 * distinguer plusieurs séries au nom proche avant de cliquer.
 * @returns {Promise<Array>} list of { id, name, url, hint }
 */
async function searchSeries(baseUrl, cookies, query) {
  await jitter();
  const res = await axios.get(`${baseUrl}/includes/recherche.php`, {
    params: { type: 'global', term: query, contenu: 'search_series' },
    headers: {
      ...baseHeaders(),
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      'Cookie': cookieHeader(cookies),
    },
    timeout: 20000,
    validateStatus: () => true,
  });

  const block = detectBlock(res.status, typeof res.data === 'string' ? res.data : null);
  if (block) {
    recordBlock(block);
    throw new ValentineBlockedError(block);
  }

  const data = Array.isArray(res.data) ? res.data : [];
  const results = [];
  for (const item of data) {
    if (!item.value || !item.id) continue;
    if (item.txt?.includes('Cliquez ici')) continue;
    const hint = stripTags(item.txt || '') || null;
    results.push({ id: String(item.id), name: stripTags(item.value), url: item.url || '', hint });
  }
  return results;
}

/**
 * Liste tous les fichiers (tomes + intégrales, sans distinction ni filtre —
 * une intégrale est juste une carte comme les autres) d'une série, à partir
 * de sa page dédiée (ex: /serie/la-guerre-des-clans). L'ID de chaque livre
 * est déjà présent dans le HTML (data-id sur la carte), pas besoin d'ouvrir
 * chaque fiche individuellement pour l'obtenir.
 * @returns {Promise<Array>} list of { id, title, author, slug }
 */
async function listSeriesFiles(baseUrl, cookies, seriesUrl) {
  await jitter();
  const res = await axios.get(`${baseUrl}${seriesUrl}`, {
    headers: { ...baseHeaders(), 'Cookie': cookieHeader(cookies) },
    timeout: 20000,
    validateStatus: () => true,
  });

  const block = detectBlock(res.status, typeof res.data === 'string' ? res.data : null);
  if (block) {
    recordBlock(block);
    throw new ValentineBlockedError(block);
  }

  const html = typeof res.data === 'string' ? res.data : '';
  const results = [];
  const seenSlugs = new Set();

  // (patch) : la balise eBookInfo peut avoir ses attributs dans un ordre
  // différent selon le type de page (série vs auteur) — l'ancien regex exigeait
  // data-id PUIS data-slug PUIS class dans cet ordre précis et matchait donc
  // silencieusement zéro carte si l'ordre différait. On détecte maintenant la
  // balise par la seule présence de class="eBookInfo", puis on extrait
  // data-id/data-slug indépendamment de leur position dans la balise.
  const cardRe = /<div\b[^>]*\bclass="eBookInfo"[^>]*>/g;
  let m;
  while ((m = cardRe.exec(html)) !== null) {
    const tag = m[0];
    const idMatch   = tag.match(/data-id="(\d+)"/);
    const slugMatch = tag.match(/data-slug="([^"]*)"/);
    if (!idMatch || !slugMatch || !slugMatch[1] || seenSlugs.has(slugMatch[1])) continue;
    seenSlugs.add(slugMatch[1]);

    // Fenetre de recherche = contenu de cette carte, jusqu'a la carte suivante
    const nextCardIdx = html.indexOf('class="eBookInfo"', cardRe.lastIndex);
    const win = html.slice(m.index, nextCardIdx > -1 ? nextCardIdx : m.index + 1500);

    const titleMatch = win.match(/<h2 class="title"[^>]*>([\s\S]*?)<\/h2>/);
    const authorMatch = win.match(/<h3 class="writer">[\s\S]*?>([^<]+)<\/a>/);
    if (!titleMatch) continue;

    results.push({
      id: idMatch[1],
      title: stripTags(titleMatch[1]),
      author: authorMatch ? stripTags(authorMatch[1]) : null,
      slug: slugMatch[1],
    });
  }

  return results;
}

/**
 * Liste tous les livres visibles sur la page d'une fiche auteur.
 * (patch) : réutilise le même parsing de carte que listSeriesFiles — Valentine
 * semble utiliser le même gabarit de carte "eBookInfo" sur les pages série ET
 * auteur. À VÉRIFIER sur une vraie fiche auteur (Gus) : si le regex ne matche
 * rien, il faudra ajuster sur le HTML réel (structure potentiellement
 * différente, pagination pour les auteurs très prolifiques, etc.).
 * @returns {Promise<Array>} list of { id, title, author, slug }
 */
async function listAuthorFiles(baseUrl, cookies, authorUrl) {
  return listSeriesFiles(baseUrl, cookies, authorUrl);
}

/**
 * Enrichit une liste de résultats avec couverture + taille (séquentiellement,
 * avec jitter, comme searchOnValentine) et construit une valentineUrl absolue.
 * (patch) : la fiche d'un livre individuel est sur /titre/{slug} — confirmé
 * par valentine_2.py (get_author_books), pas /livre/{slug} comme précédemment
 * deviné à tort.
 */
// Recherche directe : aucun enrichissement (couverture/taille) — objectif
// vitesse, pas metadata. Pour de belles fiches, le mode standard (Google
// Books) fait déjà ça, et "Mes demandes" a un bouton pour les récupérer a
// posteriori (fetchRequestMetadata) une fois la demande créée.
function addValentineUrls(baseUrl, items) {
  return items.map(r => ({
    ...r,
    cover: null,
    size: null,
    valentineUrl: r.url ? `${baseUrl}${r.url}` : (r.slug ? `${baseUrl}/titre/${r.slug}` : null),
  }));
}

/**
 * Recherche « en deux temps » : renvoie juste la LISTE des auteurs ou séries
 * correspondants (id, name, url), sans charger leurs livres — rapide, pas
 * d'enrichissement. Le choix du bon auteur/série revient à l'utilisateur
 * (l'auto-pick du 1er résultat s'est révélé peu fiable en pratique : Valentine
 * classe ses résultats par pertinence de la recherche texte, pas par nombre
 * de livres ni par exactitude du nom).
 * @param {string} type - 'author' | 'series'
 * @returns {Promise<Array<{id, name, url}>>}
 */
export function searchValentineMatches(query, type) {
  return withValentineLock(async () => {
    const config = await getConfig();
    if (!config.enabled || !config.username || !config.password) {
      throw new Error('Valentine désactivé ou configuration incomplète');
    }
    const baseUrl = (config.url || DEFAULT_URL).replace(/\/$/, '');
    const cookies = await getSession(baseUrl, config.username, config.password);

    const matches = type === 'series'
      ? await searchSeries(baseUrl, cookies, query)
      : await searchAuthors(baseUrl, cookies, query);

    return matches.map(m => ({ id: m.id, name: m.name, url: m.url, hint: m.hint || null }));
  });
}

/**
 * Deuxième temps : liste (et enrichit) les livres d'une fiche auteur ou série
 * déjà choisie par l'utilisateur (son url, renvoyée par searchValentineMatches).
 * @param {string} pageUrl - url relative renvoyée par Valentine (ex: /auteur/xxx)
 * @param {string} type - 'author' | 'series'
 * @param {string} [fallbackName] - nom à appliquer si la carte livre n'a pas
 *   d'auteur détecté (cas normal sur une fiche auteur — cf valentine_2.py,
 *   get_author_books réutilise le nom de l'auteur recherché, pas un champ par carte).
 * @returns {Promise<Array>}
 */
export function getValentineListingBooks(pageUrl, type, fallbackName) {
  return withValentineLock(async () => {
    const config = await getConfig();
    if (!config.enabled || !config.username || !config.password) {
      throw new Error('Valentine désactivé ou configuration incomplète');
    }
    const baseUrl = (config.url || DEFAULT_URL).replace(/\/$/, '');
    const cookies = await getSession(baseUrl, config.username, config.password);

    const files = type === 'series'
      ? await listSeriesFiles(baseUrl, cookies, pageUrl)
      : await listAuthorFiles(baseUrl, cookies, pageUrl);

    const withFallbackAuthor = type === 'author'
      ? files.map(f => ({ ...f, author: f.author || fallbackName || null }))
      : files;

    return addValentineUrls(baseUrl, withFallbackAuthor);
  });
}

/**
 * Fetch cover image URL and file size from the ebook modal.
 */
async function getBookDetails(baseUrl, cookies, bookId) {
  try {
    await jitter();
    const res = await axios.post(
      `${baseUrl}/pages/eBookModalNew.php`,
      new URLSearchParams({ ebook_id: bookId, downloaded: '0' }).toString(),
      {
        headers: {
          ...baseHeaders(),
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': cookieHeader(cookies),
        },
        timeout: 15000,
        validateStatus: () => true,
      }
    );
    const html = res.data || '';

    // Cover: <img src="..." class="couverture"> (attribute order may vary)
    const coverMatch = html.match(/class=["']couverture["'][^>]*>|<img[^>]+class=["']couverture["']/);
    let cover = null;
    if (coverMatch) {
      const srcMatch = html.slice(html.indexOf('<img', html.indexOf(coverMatch[0]) > 0 ? html.indexOf(coverMatch[0]) - 200 : 0))
        .match(/src=["']([^"']+)["']/);
      if (srcMatch) cover = srcMatch[1].startsWith('http') ? srcMatch[1] : `${baseUrl}${srcMatch[1]}`;
    }
    // Fallback cover extraction
    if (!cover) {
      const imgCover = html.match(/<img[^>]+src=["']([^"']+)["'][^>]*class=["']couverture["']/);
      if (imgCover) cover = imgCover[1].startsWith('http') ? imgCover[1] : `${baseUrl}${imgCover[1]}`;
    }

    // Size + format: <span class="poids-ebook">ePub - 0.56 Mo</span>
    const sizeMatch = html.match(/<span[^>]+class=["']poids-ebook["'][^>]*>([^<]+)<\/span>/);
    const size = sizeMatch ? sizeMatch[1].trim() : null;

    return { cover, size };
  } catch {
    return { cover: null, size: null };
  }
}

/**
 * Get the download path from the ebook modal.
 * @param {string} baseUrl
 * @param {object} cookies
 * @param {string} bookId
 * @returns {Promise<string|null>} relative path like /includes/telechargement.php?...
 */
async function getDownloadPath(baseUrl, cookies, bookId) {
  await jitter();
  const res = await axios.post(
    `${baseUrl}/pages/eBookModalNew.php`,
    new URLSearchParams({ ebook_id: bookId, downloaded: '0' }).toString(),
    {
      headers: {
        ...baseHeaders(),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookieHeader(cookies),
      },
      timeout: 20000,
      validateStatus: () => true,
    }
  );

  const block = detectBlock(res.status, res.data);
  if (block) {
    recordBlock(block);
    throw new ValentineBlockedError(block);
  }

  // Extract the download href from HTML
  const match = res.data.match(/href=["'](\/includes\/telechargement\.php[^"']+)["']/);
  return match ? match[1] : null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Test the valentine.wtf connection with given credentials.
 * @param {string} username
 * @param {string} password
 */
export function testConnectionValentine(username, password) {
  return withValentineLock(async () => {
    const baseUrl = DEFAULT_URL;
    await login(baseUrl, username, password);
    return true;
  });
}

/**
 * Récupère le quota de téléchargements restants depuis la homepage valentine.wtf.
 * @param {string} username
 * @param {string} password
 * @returns {{ remaining: number|null, total: number|null, label: string|null }}
 */
export function getValentineQuota(username, password) {
  return withValentineLock(async () => {
    const baseUrl = DEFAULT_URL;
    const cookies = await getSession(baseUrl, username, password);

    await jitter();
    const homeRes = await axios.get(`${baseUrl}/`, {
      headers: {
        ...baseHeaders(),
        Cookie: cookieHeader(cookies),
      },
      timeout: 15000,
    });

    const html = homeRes.data || '';

    // Cherche <span data-hover="tooltip" title="X téléchargements restants sur Y">X</span>
    const titleMatch = html.match(/data-hover=["']tooltip["'][^>]+title=["']([^"']*restants[^"']*)["']/i)
                    || html.match(/title=["']([^"']*restants[^"']*)["'][^>]+data-hover=["']tooltip["']/i);

    if (!titleMatch) return { remaining: null, total: null, label: null };

    const label = titleMatch[1].trim(); // ex: "47 téléchargements restants sur 50"

    const remaining = parseInt(label.match(/^(\d+)/)?.[1] ?? '', 10) || null;
    const total     = parseInt(label.match(/sur\s+(\d+)/i)?.[1] ?? '', 10) || null;

    return { remaining, total, label };
  });
}

/**
 * Search valentine.wtf for a book and download it automatically.
 * Completes the BookRequest when done.
 * Non-blocking — never throws.
 *
 * @param {string} title
 * @param {string} author
 * @param {string} requestId - MongoDB ObjectId of the BookRequest
 */
export async function downloadFromValentine(title, author, requestId, category = 'ebook', userCredentials = null) {
  await withValentineLock(async () => {
  try {
    const isMangaOrComic = category === 'comic' || category === 'manga' ||
      /\b(manga|manhwa|manhua|comic|tome\s*\d+|vol\.?\s*\d+|t\d{2}\b)/i.test(title);

    if (isMangaOrComic) {
      console.log(`[Valentine] "${title}" est un comic/manga, skip.`);
      return;
    }

    const config = await getConfig();
    if (!config.enabled) {
      console.log('[Valentine] Désactivé, skip.');
      return;
    }

    // Priorité : credentials personnels du user → fallback config globale admin
    const username = userCredentials?.username || config.username;
    const password = userCredentials?.password || config.password;

    if (!username || !password) {
      console.log('[Valentine] Config incomplète (pas de credentials), skip.');
      return;
    }

    const baseUrl = (config.url || DEFAULT_URL).replace(/\/$/, '');
    const accountLabel = userCredentials ? `[compte user]` : `[compte admin]`;

    // ── Login ──────────────────────────────────────────────────────────────
    let cookies;
    try {
      cookies = await getSession(baseUrl, username, password);
    } catch (err) {
      console.error(`[Valentine] ${accountLabel} Erreur de connexion:`, err.message);
      return;
    }

    // ── Search ─────────────────────────────────────────────────────────────
    const cleanTitle = title
      .replace(/\s*[-–—:]\s+.*/u, '')
      .replace(/\s*tome\s+\d+.*/i, '')
      .replace(/\s*vol\.?\s+\d+.*/i, '')
      .replace(/\s*\(.*\)\s*/g, '')
      .trim();

    // Nettoyer l'auteur pour la recherche : "ALEXANDRE. CONTART" → "ALEXANDRE CONTART"
    const cleanAuthor = (author || '')
      .replace(/([A-ZÀ-Ÿa-zà-ÿ])\./g, '$1')  // supprimer les points après les mots
      .replace(/\s+/g, ' ')
      .trim();

    // Variante sans virgules ni points de suspension — pour les titres comme "Il pleut, un peu, beaucoup…"
    const cleanTitleNoPunct = cleanTitle.replace(/,/g, '').replace(/\.{2,}/g, '').replace(/\s+/g, ' ').trim();
    // Valentine cherche par titre uniquement (pas titre + auteur)
    const queries = [
      cleanTitle,
      ...(cleanTitleNoPunct !== cleanTitle ? [cleanTitleNoPunct] : []),
    ];
    const MIN_AUTHOR_SCORE = 0.5; // au moins 50 % des tokens auteur doivent correspondre

    let book = null;
    for (const q of queries) {
      const results = await searchTitles(baseUrl, cookies, q);
      if (!results.length) continue;

      // Restreindre aux livres dont le titre correspond exactement (si possible)
      const titleNorm = normalizeForMatch(cleanTitle);
      const byTitle = results.filter(r => normalizeForMatch(r.title) === titleNorm);
      const pool = byTitle.length ? byTitle : results;

      if (author) {
        // Scorer par correspondance auteur + vérification du numéro de tome
        const reqVolume = extractVolumeNumber(cleanTitle);
        const scored = pool
          .map(r => ({ ...r, authorScore: authorMatchScore(author, r.author), volumeOk: reqVolume === null || extractVolumeNumber(r.title) === reqVolume }))
          .filter(r => r.authorScore >= MIN_AUTHOR_SCORE && r.volumeOk)
          .sort((a, b) => b.authorScore - a.authorScore);

        if (scored.length) {
          book = scored[0];
          console.log(`[Valentine] Match "${book.title}" / "${book.author}" (score auteur: ${book.authorScore.toFixed(2)})`);
          break;
        }
        // Aucun résultat avec auteur compatible dans cette requête → essayer la suivante
        console.log(`[Valentine] Requête "${q}" : ${results.length} résultat(s) mais aucun auteur compatible`);
        continue;
      } else {
        // Pas d'auteur fourni : prendre le premier titre exact ou le premier résultat
        book = pool[0];
        break;
      }
    }

    if (!book) {
      console.log(`[Valentine] Aucun résultat avec auteur compatible pour "${title}" / "${author}"`);
      return;
    }

    // ── Download link ──────────────────────────────────────────────────────
    const dlPath = await getDownloadPath(baseUrl, cookies, book.id);
    if (!dlPath) {
      console.log(`[Valentine] Lien de téléchargement introuvable pour "${book.title}"`);
      return;
    }

    // ── Download file ──────────────────────────────────────────────────────
    await jitter();
    const fullUrl = `${baseUrl}${dlPath}`;
    const fileRes = await axios.get(fullUrl, {
      headers: {
        ...baseHeaders(),
        'Accept': '*/*',
        'Cookie': cookieHeader(cookies),
      },
      responseType: 'arraybuffer',
      timeout: 120000,
    });

    // Determine filename from Content-Disposition or fallback
    const cd = fileRes.headers['content-disposition'] || '';
    const fnMatch = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)["']?/i);
    let filename = fnMatch
      ? decodeURIComponent(fnMatch[1].trim())
      : `${cleanTitle}.epub`;
    filename = filename.replace(/[<>:"/\\|?*]/g, '').trim();
    if (!filename) filename = `${cleanTitle}.epub`;

    // Save to uploads/books/
    const uploadsDir = path.join(__dirname, '../../uploads/books');
    fs.mkdirSync(uploadsDir, { recursive: true });
    const destPath = path.join(uploadsDir, filename);
    fs.writeFileSync(destPath, Buffer.from(fileRes.data));

    console.log(`[Valentine] ✓ "${filename}" téléchargé`);

    // ── Complete the request ───────────────────────────────────────────────
    const request = await BookRequest.findById(requestId);
    if (!request) {
      console.log(`[Valentine] Demande ${requestId} introuvable`);
      return;
    }
    if (request.status === 'completed') {
      console.log(`[Valentine] Demande ${requestId} déjà complétée`);
      return;
    }

    request.status = 'completed';
    request.filePath = `books/${filename}`;
    request.completedAt = new Date();
    if (!Array.isArray(request.statusHistory)) request.statusHistory = [];
    request.statusHistory.push({
      status: 'completed',
      changedBy: 'valentine',
      note: 'Téléchargé automatiquement',
    });
    await request.save();

    // ── Post-completion hooks (non-blocking) ─────────────────────────────────
    runPostCompletionHooks(request, request.user).catch(e => console.error('[Calibre]', e.message));

    // ── Notify the user ────────────────────────────────────────────────────
    const user = await User.findById(request.user);
    if (!user) return;

    try {
      if (user.emailVerified && user.email) {
        await sendBookCompletedEmail(user, request);
      }
    } catch (e) {
      console.error('[Valentine] Erreur email:', e.message);
    }

    try {
      await sendPushToUser(user._id, {
        title: '📖 Livre disponible !',
        body: `"${title}" de ${author} a été téléchargé automatiquement.`,
        url: '/dashboard',
      });
    } catch (e) {
      console.error('[Valentine] Erreur push:', e.message);
    }

    try {
      await Notification.create({
        user: user._id,
        type: 'request_completed',
        title: request.title,
        author: request.author,
        message: `"${title}" a été téléchargé automatiquement.`,
      });
    } catch (e) {
      console.error('[Valentine] Erreur notification:', e.message);
    }
  } catch (err) {
    console.error('[Valentine] Erreur (non bloquante):', err.message);
  }
  });
}

/**
 * Search valentine.wtf and return enriched results (for admin UI — retry
 * manuel sur une demande existante). Fetches cover + size for each result.
 * Inchangé : distinct de la recherche directe (voir searchValentineTitlesFast
 * plus bas), qui elle ne doit surtout pas être ralentie par cet enrichissement.
 */
export function searchOnValentine(query) {
  return withValentineLock(async () => {
    const config = await getConfig();
    if (!config.enabled || !config.username || !config.password) {
      throw new Error('Valentine désactivé ou configuration incomplète');
    }
    const baseUrl = (config.url || DEFAULT_URL).replace(/\/$/, '');
    const cookies = await getSession(baseUrl, config.username, config.password);
    const results = await searchTitles(baseUrl, cookies, query);

    const enriched = [];
    for (const r of results) {
      const details = await getBookDetails(baseUrl, cookies, r.id);
      enriched.push({
        ...r,
        cover: details.cover,
        size: details.size,
        valentineUrl: r.url ? `${baseUrl}${r.url}` : null,
      });
    }
    return enriched;
  });
}

/**
 * Recherche par titre pour la recherche DIRECTE (bypass Google Books) —
 * volontairement sans aucun enrichissement, pour rester rapide. À ne pas
 * confondre avec searchOnValentine ci-dessus (admin, retry manuel, enrichi).
 */
export function searchValentineTitlesFast(query) {
  return withValentineLock(async () => {
    const config = await getConfig();
    if (!config.enabled || !config.username || !config.password) {
      throw new Error('Valentine désactivé ou configuration incomplète');
    }
    const baseUrl = (config.url || DEFAULT_URL).replace(/\/$/, '');
    const cookies = await getSession(baseUrl, config.username, config.password);
    const results = await searchTitles(baseUrl, cookies, query);
    return addValentineUrls(baseUrl, results);
  });
}

/**
 * Version allegee de searchOnValentine, SANS l'enrichissement couverture/taille
 * (qui ajoute 0.8-2.2s de jitter PAR resultat, volontairement lent pour rester
 * soft avec Valentine). A utiliser quand on veut juste savoir "trouve ou pas"
 * (ex: verification de disponibilite avant soumission d'une demande), pas pour
 * un affichage riche — les metadonnees affichees viennent de toute facon de
 * Google Books/Hardcover, pas de Valentine.
 *
 * @param {string} title
 * @param {string} [author] - optionnel. Utilise UNIQUEMENT en repli si la
 *   recherche par titre ne renvoie rien — jamais en parallele, pour ne pas
 *   doubler la charge sur Valentine a chaque verification.
 * @returns {Promise<{ results: Array, matchType: 'title'|'author'|null }>}
 */
export function quickSearchOnValentine(title, author) {
  return withValentineLock(async () => {
    const config = await getConfig();
    if (!config.enabled || !config.username || !config.password) {
      throw new Error('Valentine désactivé ou configuration incomplète');
    }
    const baseUrl = (config.url || DEFAULT_URL).replace(/\/$/, '');
    const cookies = await getSession(baseUrl, config.username, config.password);

    const titleResults = await searchTitles(baseUrl, cookies, title);
    if (titleResults.length > 0) {
      return { results: titleResults, matchType: 'title' };
    }

    // Repli auteur : UNE seule requete supplementaire, seulement si le titre
    // n'a rien donne. Confirme la presence de l'auteur sur Valentine, pas
    // forcement de ce livre precis — signal plus faible, a traiter comme tel
    // cote appelant (confiance "medium", pas "high").
    if (author && author.trim()) {
      const authorResults = await searchAuthors(baseUrl, cookies, author.trim());
      if (authorResults.length > 0) {
        return { results: authorResults, matchType: 'author' };
      }
    }

    return { results: [], matchType: null };
  });
}

/**
 * Download a specific ebook by its valentine ID for a given request (admin manual action).
 */
export function downloadFromValentineById(requestId, ebookId) {
  return withValentineLock(async () => {
    const config = await getConfig();
    if (!config.enabled || !config.username || !config.password) {
      throw new Error('Valentine désactivé ou configuration incomplète');
    }
    const baseUrl = (config.url || DEFAULT_URL).replace(/\/$/, '');
    const cookies = await getSession(baseUrl, config.username, config.password);

    const dlPath = await getDownloadPath(baseUrl, cookies, ebookId);
    if (!dlPath) throw new Error('Lien de téléchargement introuvable pour cet ebook');

    await jitter();
    const fileRes = await axios.get(`${baseUrl}${dlPath}`, {
      headers: { ...baseHeaders(), 'Accept': '*/*', 'Cookie': cookieHeader(cookies) },
      responseType: 'arraybuffer',
      timeout: 120000,
    });

    const cd = fileRes.headers['content-disposition'] || '';
    const fnMatch = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)["']?/i);
    let filename = fnMatch ? decodeURIComponent(fnMatch[1].trim()) : `valentine_${ebookId}.epub`;
    filename = filename.replace(/[<>:"/\\|?*]/g, '').trim() || `valentine_${ebookId}.epub`;

    const uploadsDir = path.join(__dirname, '../../uploads/books');
    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.writeFileSync(path.join(uploadsDir, filename), Buffer.from(fileRes.data));

    // Complete the request
    const request = await BookRequest.findById(requestId);
    if (!request) throw new Error('Demande introuvable');
    if (request.status === 'completed') throw new Error('Demande déjà complétée');

    request.status = 'completed';
    request.filePath = `books/${filename}`;
    request.completedAt = new Date();
    if (!Array.isArray(request.statusHistory)) request.statusHistory = [];
    request.statusHistory.push({ status: 'completed', changedBy: 'admin-valentine', note: 'Téléchargé manuellement via Valentine' });
    await request.save();

    // ── Post-completion hooks (non-blocking) ───────────────────────────────────
    runPostCompletionHooks(request, request.user).catch(e => console.error('[Calibre]', e.message));

    // Notify user
    const user = await User.findById(request.user);
    if (user) {
      try { if (user.emailVerified && user.email) await sendBookCompletedEmail(user, request); } catch {}
      try { await sendPushToUser(user._id, { title: '📖 Livre disponible !', body: `"${request.title}" est maintenant disponible.`, url: '/dashboard' }); } catch {}
      try { await Notification.create({ user: user._id, type: 'request_completed', title: request.title, author: request.author, message: `"${request.title}" a été téléchargé.` }); } catch {}
    }

    return { filename, filePath: `books/${filename}` };
  });
}