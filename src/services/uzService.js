import axios from 'axios';
import ConnectorSettings from '../models/ConnectorSettings.js';
import { decrypt } from './cryptoService.js';
import { getProxyConfig, getProxyAgent } from './proxyConfig.js';

// UZ : forum listant des topics BD/Comics/Mangas
// avec, dans les posts, des liens vers des hébergeurs tiers (1fichier, Uptobox...).
// Le forum n'héberge rien lui-même — contrairement à Valentine/Fourtoutici, pas
// de téléchargement automatique possible ici : on ne fait que de la RECHERCHE,
// l'admin clique ensuite le lien du topic pour aller chercher le fichier à la main.
// Authentification par cookie de session (PHPSESSID + __Host-flux_cookie), fourni
// par l'admin depuis son navigateur (pas de login programmatique géré ici).

const DEFAULT_URL = 'https://ultim-zone.in';
// Forum IDs internes du site pour BD / Comics / Mangas / Livres / Romans /
// Livre de Jeu de rôles (cf. search.php, fieldset "Lecture" du formulaire de
// recherche avancée) — distincts des numéros utilisés dans les URLs de
// listing (forum-203/204/205-...-page-N.html) mais, ici, identiques.
const FORUM_IDS = ['203', '204', '205', '147', '188', '151'];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:124.0) Gecko/20100101 Firefox/124.0',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
};

export async function getUltimZoneConfig() {
  const doc = await ConnectorSettings.findOne({ service: 'ultimzone' }).lean();
  return doc || { service: 'ultimzone', enabled: false, url: DEFAULT_URL, apiKey: '', password: '' };
}

// Les deux valeurs de session (chiffrées séparément, comme les autres secrets
// de ce schéma — apiKey pour PHPSESSID, password réutilisé pour
// __Host-flux_cookie) sont fournies par l'admin directement depuis son
// navigateur connecté au forum — pas de login géré ici, juste une
// réutilisation de session comme Fourtoutici/Valentine le font avec leurs
// propres cookies.
function getSessionCookie(doc) {
  if (!doc?.apiKey || !doc?.password) return null;
  const phpsessid = decrypt(doc.apiKey) ?? doc.apiKey;
  const fluxCookie = decrypt(doc.password) ?? doc.password;
  return `PHPSESSID=${phpsessid}; __Host-flux_cookie=${fluxCookie}`;
}

async function axiosWithProxy(method, url, axiosOptions, label) {
  const proxy = await getProxyConfig();

  const direct = () => axios({ method, url, ...axiosOptions });
  const viaProxy = () => axios({ method, url, ...axiosOptions, httpsAgent: getProxyAgent(proxy.url), proxy: false });

  if (!proxy.enabled) return direct();

  const secondVia = proxy.mode === 'default' ? 'connexion directe' : 'proxy';
  const [first, second] = proxy.mode === 'default' ? [viaProxy, direct] : [direct, viaProxy];
  try {
    return await first();
  } catch (err) {
    console.warn(`[UltimZone] ${label} échec (${err.response?.status || err.code || err.message}), tentative via ${secondVia}`);
    const result = await second();
    console.log(`[UltimZone] ${label} réussi via ${secondVia}`);
    return result;
  }
}

// Décode les entités HTML les plus courantes rencontrées dans les titres
// (le forum n'en échappe que quelques-unes, pas la totalité d'UTF-8).
function decodeEntities(str) {
  return (str || '')
    .replace(/&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&eacute;/g, 'é')
    .replace(/&egrave;/g, 'è')
    .trim();
}

/**
 * Recherche sur UZ (BD/Comics/Mangas). Un topic peut apparaître
 * plusieurs fois dans les résultats bruts (plusieurs posts/re-up dans le même
 * topic) — on déduplique par id de topic, en gardant la première occurrence
 * (généralement le post le plus pertinent/le message d'origine).
 */
export async function searchOnUltimZone(query) {
  const doc = await getUltimZoneConfig();
  if (!doc.enabled) throw new Error('Connecteur Ultim-Zone désactivé');

  const cookie = getSessionCookie(doc);
  if (!cookie) throw new Error('Cookie de session Ultim-Zone manquant');

  const baseUrl = (doc.url || DEFAULT_URL).replace(/\/$/, '');
  const params = new URLSearchParams();
  params.append('action', 'search');
  params.append('keywords', query);
  params.append('author', '');
  params.append('search_in', '0');
  params.append('sort_by', '0');
  params.append('sort_dir', 'ASC');
  params.append('show_as', 'posts');
  params.append('search', 'Valider');
  for (const id of FORUM_IDS) params.append('forums[]', id);

  const res = await axiosWithProxy('post', `${baseUrl}/search.php`, {
    data: params.toString(),
    headers: { ...HEADERS, Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 20000,
    maxRedirects: 5,
  }, `search "${query}"`);

  const html = res.data;
  if (typeof html !== 'string') throw new Error('Réponse Ultim-Zone invalide');

  // Session invalide/expirée : le forum redirige vers login.php ou affiche le
  // formulaire de connexion à la place des résultats.
  if (html.includes('name="req_login"') || /action="login\.php"/.test(html)) {
    throw new Error('Session Ultim-Zone expirée — renouveler le cookie depuis le navigateur');
  }

  // Chaque résultat : "» <a href="viewtopic.php?id=NNN">Titre</a>" précédé du
  // nom du forum ("» <a href="viewforum.php?id=203">Bandes Dessinées</a>").
  const BLOCK_RE = /<a href="viewforum\.php\?id=(\d+)">([^<]*)<\/a><\/span> <span>»&#160;<a href="viewtopic\.php\?id=(\d+)">([^<]*)<\/a>/g;

  const seen = new Set();
  const results = [];
  let m;
  while ((m = BLOCK_RE.exec(html)) !== null) {
    const [, , forumLabel, topicId, title] = m;
    if (seen.has(topicId)) continue;
    seen.add(topicId);
    results.push({
      topicId,
      title: decodeEntities(title),
      category: decodeEntities(forumLabel),
      annaUrl: `${baseUrl}/viewtopic.php?id=${topicId}`,
      source: 'ultimzone',
    });
  }

  return { results, baseUrl };
}

export async function pingUltimZone() {
  const doc = await getUltimZoneConfig();
  const cookie = getSessionCookie(doc);
  if (!cookie) throw new Error('Cookie de session Ultim-Zone manquant');

  const baseUrl = (doc.url || DEFAULT_URL).replace(/\/$/, '');
  const res = await axiosWithProxy('get', `${baseUrl}/search.php`, {
    headers: { ...HEADERS, Cookie: cookie },
    timeout: 10000,
  }, 'ping');

  if (typeof res.data === 'string' && /action="login\.php"/.test(res.data)) {
    throw new Error('Session Ultim-Zone expirée — renouveler le cookie depuis le navigateur');
  }

  return { ok: true, baseUrl };
}
