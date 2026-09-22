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
import { getProxyConfig, getProxyAgent } from './proxyConfig.js';
import { fetchFromGoogle } from '../routes/googleBooks.js';
import { isGoogleBooksSearchEnabled } from './googleBooksConfig.js';

// Fourtoutici : bibliothèque communautaire, API JSON native (pas de scraping HTML),
// pas de compte/login, pas de quota, pas de protection anti-bot connue à ce jour.
// Le domaine change régulièrement au gré des blocages DNS FAI (.cc, .pro, .top...) :
// l'URL reste donc configurable côté admin, comme pour LibGen.
// Couverture : EBOOK, BD, MANGA, JOURNAL, MAGAZINE, AUDIO, AUTRES — on ne recherche
// que les catégories livres par défaut (EBOOK, BD, MANGA).

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_URL = 'https://fourtoutici.cc';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:124.0) Gecko/20100101 Firefox/124.0',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
};

const KNOWN_EBOOK_EXTS = new Set(['epub', 'mobi', 'pdf', 'cbz', 'cbr', 'cb7', 'azw', 'azw3', 'fb2', 'djvu', 'txt']);
const BOOK_CATEGORIES = new Set(['EBOOK', 'BD', 'MANGA']);

export async function getFourtouticiConfig() {
  const doc = await ConnectorSettings.findOne({ service: 'fourtoutici' }).lean();
  return doc || { service: 'fourtoutici', enabled: false, url: DEFAULT_URL };
}

export async function saveFourtouticiConfig({ enabled, url }) {
  return ConnectorSettings.findOneAndUpdate(
    { service: 'fourtoutici' },
    { enabled: !!enabled, url: url?.trim() || DEFAULT_URL },
    { upsert: true, new: true, runValidators: true }
  );
}

// ── Session ──────────────────────────────────────────────────────────────────
// L'API exige un cookie de session (FOURTOUTICISESSID + FTICI_CSRF). Contrairement
// à ce qu'on pourrait attendre, la page d'accueil (/) ne les pose PAS elle-même :
// c'est le script client security.js qui appelle /backend/api/session.php au
// chargement pour les obtenir — donc c'est cet endpoint qu'il faut interroger
// directement, pas / (vérifié par inspection du bundle JS, 09/2026).
let cachedCookie = null;

async function fetchSessionCookie(baseUrl) {
  console.log(`[Fourtoutici][verbose] Récupération d'un nouveau cookie de session sur ${baseUrl}/backend/api/session.php`);
  const res = await axios.get(`${baseUrl}/backend/api/session.php`, { headers: HEADERS, timeout: 10000 });
  console.log(`[Fourtoutici][verbose] session.php → status ${res.status}, set-cookie brut :`, res.headers['set-cookie']);
  const setCookie = res.headers['set-cookie'] || [];
  const cookie = setCookie.map(c => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('Aucun cookie de session reçu de Fourtoutici');
  console.log(`[Fourtoutici][verbose] Cookie obtenu : ${cookie}`);
  cachedCookie = cookie;
  return cookie;
}

async function getSessionCookie(baseUrl) {
  if (cachedCookie) {
    console.log(`[Fourtoutici][verbose] Réutilisation du cookie en cache : ${cachedCookie}`);
    return cachedCookie;
  }
  return fetchSessionCookie(baseUrl);
}

// Même logique de repli proxy que les autres connecteurs sortants.
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
    console.warn(`[Fourtoutici] ${label} échec (${err.response?.status || err.code || err.message}), tentative via ${secondVia}`);
    const result = await second();
    console.log(`[Fourtoutici] ${label} réussi via ${secondVia}`);
    return result;
  }
}

// Requête authentifiée par cookie de session ; si le cookie est rejeté (401/403),
// on en redemande un nouveau et on retente une fois avant d'abandonner.
async function apiGet(baseUrl, urlPath, label) {
  console.log(`[Fourtoutici][verbose] apiGet → ${baseUrl}${urlPath}`);
  const cookie = await getSessionCookie(baseUrl);
  try {
    const res = await axiosGetWithProxy(`${baseUrl}${urlPath}`, {
      headers: { ...HEADERS, Cookie: cookie },
      timeout: 20000,
    }, label);
    console.log(`[Fourtoutici][verbose] apiGet → status ${res.status}, content-type: ${res.headers['content-type']}`);
    return res;
  } catch (err) {
    console.log(`[Fourtoutici][verbose] apiGet → erreur : status=${err.response?.status} data=${JSON.stringify(err.response?.data)?.slice(0, 300)} message=${err.message}`);
    if (err.response?.status === 401 || err.response?.status === 403) {
      console.log(`[Fourtoutici] Cookie de session rejeté, renouvellement…`);
      const fresh = await fetchSessionCookie(baseUrl);
      return axiosGetWithProxy(`${baseUrl}${urlPath}`, {
        headers: { ...HEADERS, Cookie: fresh },
        timeout: 20000,
      }, label);
    }
    throw err;
  }
}

/**
 * Extrait un titre et un auteur exploitables depuis original_name.
 * Formats observés : "EBOOK Titre – Auteur.epub", "BD Série 01 Titre.cbz",
 * "MANGA Série 03.cbz" — seul EBOOK a un séparateur « – Auteur » fiable ;
 * pour BD/MANGA, on garde tout le titre et on laisse l'auteur à null.
 */
/**
 * Fourtoutici n'impose aucun ordre strict aux uploadeurs (la charte demande juste
 * "EBOOK Titre" + "Auteur obligatoire", pas un format machine) : certains nomment
 * "Titre – Auteur", d'autres "Auteur – Titre". On ne peut pas deviner l'ordre avec
 * certitude à partir du seul nom de fichier — donc on renvoie les deux segments
 * sans trancher, et c'est l'appelant (qui connaît le titre/auteur réellement
 * demandés) qui décide de la bonne orientation au moment du scoring.
 */
// Articles (français + anglais) qui commencent presque toujours un titre,
// jamais un nom de personne — signal fiable et gratuit (pas d'appel réseau)
// pour deviner l'orientation "titre – auteur" vs "auteur – titre" quand le
// nom de fichier ne le précise pas. Découverte du 10/09/2026 : un segment
// "La Chambre Aux Miroirs" pris à tort pour un auteur faute de ce signal.
const TITLE_ARTICLE_RE = /^(le|la|les|l['’]|un|une|des|du|de\s+la|de\s+l['’]|the|a|an)\s/i;

function looksLikeTitle(segment) {
  if (!TITLE_ARTICLE_RE.test(segment)) return false;
  // Un article suivi d'un seul mot est presque toujours un nom de famille
  // ("Le Pen", "La Fontaine", "Le Guin", "Du Maurier", "Des Cars"…) plutôt
  // qu'un titre — un vrai titre commençant par un article a presque toujours
  // au moins un mot de plus ("Le Petit Prince", "La Chambre Aux Miroirs").
  // En dessous de 3 mots, on ne compte plus ça comme un signal fiable : on
  // laisse la vérification Google Books trancher plutôt que de deviner.
  const wordCount = segment.trim().split(/\s+/).length;
  return wordCount >= 3;
}

function parseTitleAuthor(originalName, category) {
  const noExt = originalName.replace(/\.[a-zA-Z0-9]+$/, '');
  const noCat = noExt.replace(new RegExp(`^${category}\\s+`, 'i'), '').trim();

  if (category === 'EBOOK') {
    const dashMatch = noCat.match(/^(.+?)\s*[–-]\s*([^–-]+)$/);
    if (dashMatch) {
      const partA = dashMatch[1].trim();
      const partB = dashMatch[2].trim();
      // Fourtoutici n'impose aucun ordre "titre – auteur" fiable, et aucune
      // heuristique locale (articles, nombre de mots…) ne suffit à trancher
      // avec certitude — trop de contre-exemples réels : noms d'auteurs
      // commençant par un article ("Le Pen", "La Fontaine", "Le Guin"), et
      // certains sites listent nom-prénom ("Le Pen Marine", "Des Cars Guy"),
      // ce qui déjoue aussi un seuil sur le nombre de mots. On marque donc
      // systématiquement ce cas comme ambigu et on laisse
      // disambiguateViaGoogleBooks vérifier contre un vrai livre existant —
      // seul signal vraiment fiable ici. La règle des articles (looksLikeTitle)
      // ne sert plus qu'en tout dernier recours si Google Books lui-même ne
      // tranche pas (désactivé, en erreur, ou aucune orientation ne matche).
      return { title: partA, author: partB, altTitle: partB, altAuthor: partA, ambiguous: true };
    }
  }
  return { title: noCat, author: null, altTitle: null, altAuthor: null, ambiguous: false };
}

/**
 * Second niveau de désambiguïsation, pour les cas que l'heuristique des
 * articles ne tranche pas (ex. "P.d. James – Meurtre dans un Fauteuil" : ni
 * l'un ni l'autre segment ne commence par un article détectable). On
 * interroge Google Books avec les deux orientations possibles — laquelle
 * des deux (auteur, titre) correspond à un vrai livre existant — et on
 * retient celle qui renvoie des résultats. Best-effort : en cas d'échec,
 * de désactivation admin de Google Books, ou si aucune des deux orientations
 * ne renvoie rien, on ne tranche pas (reste sur l'orientation par défaut,
 * le bouton d'inversion manuel reste le dernier recours).
 */
async function disambiguateViaGoogleBooks(partA, partB) {
  try {
    if (!(await isGoogleBooksSearchEnabled())) return null;
    const [asTitleA, asTitleB] = await Promise.all([
      fetchFromGoogle(`intitle:"${partA}" inauthor:"${partB}"`, 1, 0, { retries: 0, boost503: false }),
      fetchFromGoogle(`intitle:"${partB}" inauthor:"${partA}"`, 1, 0, { retries: 0, boost503: false }),
    ]);
    if (asTitleA.totalItems > 0 && asTitleA.totalItems >= asTitleB.totalItems) {
      return { title: partA, author: partB };
    }
    if (asTitleB.totalItems > 0) {
      return { title: partB, author: partA };
    }
    return null;
  } catch (err) {
    console.log(`[Fourtoutici][verbose] Désambiguïsation Google Books échouée pour "${partA}" / "${partB}": ${err.message}`);
    return null;
  }
}

const KNOWN_CATEGORIES = new Set(['EBOOK', 'BD', 'MANGA', 'JOURNAL', 'MAGAZINE', 'AUDIO', 'AUTRES']);

/**
 * files.php ne renvoie PAS de champ `category` dans sa réponse (contrairement à
 * suggest.php, l'autocomplétion, qui en a un — vérifié empiriquement, 09/2026).
 * La catégorie est donc déduite du préfixe de original_name, comme le fait déjà
 * parseTitleAuthor() pour retirer ce même préfixe du titre.
 */
function extractCategory(originalName) {
  const match = originalName.match(/^([A-ZÀ-Ÿ]+)\s/);
  return match && KNOWN_CATEGORIES.has(match[1]) ? match[1] : null;
}

/**
 * Recherche sur Fourtoutici. Retourne la même forme que searchOnLibgen()/
 * searchOnAnnasArchive() pour être interchangeable dans le pipeline existant.
 * @param {string} query
 * @param {string[]} [categories] - défaut : EBOOK, BD, MANGA
 */
export async function searchOnFourtoutici(query, categories = ['EBOOK', 'BD', 'MANGA']) {
  const config = await getFourtouticiConfig();
  console.log(`[Fourtoutici][verbose] searchOnFourtoutici("${query}") — config:`, config);
  if (!config.enabled) throw new Error('Connecteur Fourtoutici désactivé');

  const baseUrl = (config.url || DEFAULT_URL).replace(/\/$/, '');
  const res = await apiGet(baseUrl, `/backend/api/files.php?q=${encodeURIComponent(query)}`, `search "${query}"`);

  const data = res.data;
  console.log(`[Fourtoutici][verbose] Réponse brute files.php :`, JSON.stringify(data)?.slice(0, 1000));
  if (!data?.success || !Array.isArray(data.files)) {
    throw new Error('Réponse Fourtoutici invalide');
  }
  console.log(`[Fourtoutici][verbose] ${data.files.length} fichier(s) reçu(s) avant filtrage catégorie (${categories.join('/')})`);

  const allowed = new Set(categories);
  const results = data.files
    .map(f => ({ ...f, _category: extractCategory(f.original_name) }))
    .filter(f => f._category && allowed.has(f._category))
    .map(f => {
      const { title, author, altTitle, altAuthor, ambiguous } = parseTitleAuthor(f.original_name, f._category);
      const ext = (f.extension || '').toLowerCase();
      return {
        fileId: f.file_id,
        title,
        author,
        altTitle,
        altAuthor,
        ambiguous,
        cover: null,
        format: KNOWN_EBOOK_EXTS.has(ext) ? ext : null,
        size: f.size ? `${(f.size / 1024 / 1024).toFixed(2)} Mo` : null,
        lang: 'fr', // site francophone exclusivement
        year: f.created_at ? f.created_at.slice(0, 4) : null,
        category: f._category,
        // Conserve le nom `annaUrl` : le reste du pipeline (UI, notifications) l'attend déjà
        annaUrl: `${baseUrl}/backend/api/download.php?file_id=${f.file_id}`,
        source: 'fourtoutici',
      };
    });
  console.log(`[Fourtoutici][verbose] ${results.length} résultat(s) après filtrage catégorie :`, results.map(r => ({ title: r.title, author: r.author, category: r.category })));

  // Désambiguïsation Google Books pour les résultats que l'heuristique des
  // articles n'a pas su trancher — en parallèle, best-effort (voir
  // disambiguateViaGoogleBooks). N'affecte pas les cas déjà résolus.
  const stillAmbiguous = results.filter(r => r.ambiguous);
  if (stillAmbiguous.length) {
    console.log(`[Fourtoutici][verbose] Désambiguïsation pour ${stillAmbiguous.length} résultat(s) ambigu(s)`);
    await Promise.all(stillAmbiguous.map(async r => {
      let resolved = await disambiguateViaGoogleBooks(r.title, r.author);
      let via = 'Google Books';
      if (!resolved) {
        // Repli local, seulement si Google Books lui-même n'a pas tranché
        // (désactivé, en erreur, ou aucune orientation ne matche un livre
        // existant) — dernier recours avant l'orientation par défaut, le
        // bouton d'inversion manuel restant le tout dernier filet.
        const aLooksTitle = looksLikeTitle(r.title);
        const bLooksTitle = looksLikeTitle(r.author);
        if (aLooksTitle && !bLooksTitle) { resolved = { title: r.title, author: r.author }; via = 'règle des articles'; }
        else if (bLooksTitle && !aLooksTitle) { resolved = { title: r.author, author: r.title }; via = 'règle des articles'; }
      }
      if (resolved) {
        console.log(`[Fourtoutici][verbose] Résolu via ${via} : "${r.title}"/"${r.author}" → titre="${resolved.title}", auteur="${resolved.author}"`);
        r.title = resolved.title;
        r.author = resolved.author;
        r.altTitle = resolved.author;
        r.altAuthor = resolved.title;
      }
      r.ambiguous = undefined;
    }));
  }

  return { results, baseUrl };
}

/**
 * Télécharge un fichier par son file_id et complète la demande, comme
 * downloadFromAnnas()/downloadFromLibgen() — pas de page HTML à parser ici,
 * l'API renvoie le fichier directement.
 */
export async function downloadFromFourtoutici(fileId, requestId) {
  const config = await getFourtouticiConfig();
  if (!config.enabled) throw new Error('Connecteur Fourtoutici désactivé');

  const baseUrl = (config.url || DEFAULT_URL).replace(/\/$/, '');
  console.log(`[Fourtoutici] Téléchargement file_id=${fileId} pour demande ${requestId}`);

  const cookie = await getSessionCookie(baseUrl);
  const doDownload = async (cookieToUse) => axiosGetWithProxy(
    `${baseUrl}/backend/api/download.php?file_id=${fileId}`,
    {
      headers: { ...HEADERS, Cookie: cookieToUse },
      responseType: 'arraybuffer',
      timeout: 45000,
      validateStatus: s => s < 400,
    },
    `download ${fileId}`
  );

  let res;
  try {
    res = await doDownload(cookie);
  } catch (err) {
    if (err.response?.status === 401 || err.response?.status === 403) {
      const fresh = await fetchSessionCookie(baseUrl);
      res = await doDownload(fresh);
    } else {
      throw err;
    }
  }

  const contentType = res.headers['content-type'] || '';
  if (contentType.includes('text/html') || contentType.includes('application/json')) {
    throw new Error(`Réponse inattendue de Fourtoutici (${contentType.split(';')[0].trim()})`);
  }

  const fileBuffer = Buffer.from(res.data);
  if (!fileBuffer.length) throw new Error('Fichier vide reçu de Fourtoutici');

  // ── Nom de fichier : depuis Content-Disposition en priorité ─────────────
  const cd = res.headers['content-disposition'] || '';
  const fnMatch = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)["']?/i);
  let serverFilename = fnMatch ? decodeURIComponent(fnMatch[1].trim()) : null;
  const serverExt = serverFilename
    ? path.extname(serverFilename).toLowerCase().replace('.', '')
    : null;

  const request = await BookRequest.findById(requestId);
  if (!request) throw new Error(`Demande ${requestId} introuvable`);
  if (request.status === 'completed') {
    console.log(`[Fourtoutici] Demande ${requestId} déjà complétée`);
    return;
  }

  const ext = KNOWN_EBOOK_EXTS.has(serverExt) ? serverExt : 'epub';
  const baseName = request.title.replace(/[<>:"/\\|?*]/g, '').trim();
  const filename = `${baseName}.${ext}`.replace(/[<>:"/\\|?*]/g, '').trim() || `${fileId}.${ext}`;

  // ── Save file ─────────────────────────────────────────────────────────────
  const uploadsDir = path.join(__dirname, '../../uploads/books');
  fs.mkdirSync(uploadsDir, { recursive: true });
  const destPath = path.join(uploadsDir, filename);
  fs.writeFileSync(destPath, fileBuffer);
  console.log(`[Fourtoutici] ✓ Fichier sauvegardé: ${filename} (${(fileBuffer.length / 1024).toFixed(0)} Ko)`);

  // ── Complete request ──────────────────────────────────────────────────────
  request.status = 'completed';
  request.filePath = `books/${filename}`;
  request.completedAt = new Date();
  if (!Array.isArray(request.statusHistory)) request.statusHistory = [];
  request.statusHistory.push({
    status: 'completed',
    changedBy: 'fourtoutici',
    note: 'Téléchargé automatiquement via Fourtoutici',
  });
  await request.save();

  // ── Post-completion hooks (non-blocking) ─────────────────────────────────
  runPostCompletionHooks(request, request.user).catch(e => console.error('[Calibre]', e.message));

  // ── Notify user ───────────────────────────────────────────────────────────
  const user = await User.findById(request.user);
  if (!user) return;

  try {
    if (user.emailVerified && user.email) await sendBookCompletedEmail(user, request);
  } catch (e) { console.error('[Fourtoutici] Erreur email:', e.message); }

  try {
    await sendPushToUser(user._id, {
      title: 'Livre disponible !',
      body: `"${request.title}" a été téléchargé automatiquement.`,
      url: '/dashboard',
    });
  } catch (e) { console.error('[Fourtoutici] Erreur push:', e.message); }

  try {
    await Notification.create({
      user: user._id,
      type: 'request_completed',
      title: request.title,
      author: request.author,
      message: `"${request.title}" a été téléchargé automatiquement via Fourtoutici.`,
    });
  } catch (e) { console.error('[Fourtoutici] Erreur notification:', e.message); }

  return { filename };
}

export async function pingFourtoutici() {
  const config = await getFourtouticiConfig();
  const baseUrl = (config.url || DEFAULT_URL).replace(/\/$/, '');
  await fetchSessionCookie(baseUrl);
  return { ok: true, baseUrl };
}
