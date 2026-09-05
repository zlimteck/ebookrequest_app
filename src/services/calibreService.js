import axios from 'axios';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import { decrypt } from './cryptoService.js';

const TIMEOUT = 120000;

/**
 * Obtain a session cookie for password-based auth.
 * Calibre-Web uses Flask-WTF → requires a CSRF token extracted from the login page.
 */
export async function getSessionCookie(url, username, password) {
  const loginPage = await axios.get(`${url}/login`, {
    timeout: TIMEOUT,
    validateStatus: s => s < 500,
  });

  const csrfMatch = loginPage.data?.match(/name="csrf_token"[^>]*value="([^"]+)"/);
  const csrfToken = csrfMatch ? csrfMatch[1] : null;

  const initialCookies = (loginPage.headers['set-cookie'] || [])
    .map(c => c.split(';')[0])
    .join('; ');

  const params = new URLSearchParams();
  params.append('username', username);
  params.append('password', password);
  params.append('remember_me', 'on');
  if (csrfToken) params.append('csrf_token', csrfToken);

  const response = await axios.post(`${url}/login`, params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(initialCookies ? { Cookie: initialCookies } : {}),
    },
    maxRedirects: 0,
    validateStatus: (s) => s < 500,
    timeout: TIMEOUT,
  });

  const setCookie = response.headers['set-cookie'];
  if (!setCookie || setCookie.length === 0) {
    throw new Error('Authentification Calibre-Web échouée : aucun cookie de session reçu');
  }

  const allCookies = [
    ...initialCookies.split('; ').filter(Boolean),
    ...setCookie.map(c => c.split(';')[0]),
  ];
  return [...new Set(allCookies)].join('; ');
}

/**
 * Normalise le nom d'une étagère tel qu'affiché dans la sidebar HTML :
 * retire les balises, le compteur final " (N)" et le suffixe " (Public)"
 * (dans n'importe quel ordre, chacun optionnel) — indépendamment du fait
 * que l'étagère soit publique ou privée, ça n'a aucune incidence sur le
 * choix de l'utilisateur de synchroniser dessus ou non.
 */
function normalizeShelfDisplayName(raw) {
  return raw
    .replace(/<[^>]+>/g, '')
    .replace(/\s+\(\d+\)\s*$/, '')      // compteur de livres " (N)"
    .replace(/\s+\(Public\)\s*$/i, '')  // suffixe public
    .replace(/\s+\(\d+\)\s*$/, '')      // au cas où le compteur suivait le suffixe public
    .trim();
}

/**
 * Scrape la homepage Calibre-Web pour lister les étagères visibles par
 * l'utilisateur connecté (approche valable sur Calibre-Web classique ET
 * Calibre-Web-Automated ET Calibre-Web-NextGen, qui sert toujours la même
 * sidebar côté serveur).
 */
async function scrapeShelvesFromHomepage(url, cookie) {
  const homeRes = await axios.get(`${url}/`, {
    headers: { Cookie: cookie },
    timeout: TIMEOUT,
    validateStatus: s => s < 500,
  });

  const shelves = [];
  if (homeRes.status === 200 && typeof homeRes.data === 'string') {
    const re = /href="\/shelf\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    const seen = new Set();
    while ((match = re.exec(homeRes.data)) !== null) {
      const id = parseInt(match[1], 10);
      if (seen.has(id)) continue;
      seen.add(id);
      shelves.push({ id, name: normalizeShelfDisplayName(match[2]) });
    }
  }
  return shelves;
}

/**
 * Liste les étagères disponibles pour l'utilisateur.
 * - Si flavorHint === 'nextgen' (ou inconnu/''), on tente d'abord l'API JSON
 *   /api/v1/shelves (Calibre-Web-NextGen uniquement).
 * - Sinon (flavorHint === 'classic', ou si l'API répond 404), on scrape la
 *   homepage — valable sur les deux forks.
 * Retourne { shelves: [{id, name}], detectedFlavor }.
 */
export async function listShelves(url, cookie, flavorHint = '') {
  if (flavorHint !== 'classic') {
    try {
      const apiRes = await axios.get(`${url}/api/v1/shelves`, {
        headers: { Cookie: cookie, Accept: 'application/json' },
        timeout: TIMEOUT,
        validateStatus: s => s < 500,
      });
      if (apiRes.status === 200 && apiRes.data && Array.isArray(apiRes.data.items)) {
        return {
          detectedFlavor: 'nextgen',
          shelves: apiRes.data.items.map(s => ({ id: s.id, name: s.name })),
        };
      }
      // Statut inattendu (ni 200 avec items, ni 404) : on retombe sur le scraping
      // plutôt que de faire échouer l'appel — mais sans conclure "classic" pour
      // autant, la détection reste incertaine.
    } catch {
      // Erreur réseau : on retombe aussi sur le scraping.
    }
  }

  const shelves = await scrapeShelvesFromHomepage(url, cookie);
  return { detectedFlavor: 'classic', shelves };
}

/**
 * Trouve (ou crée) une étagère par nom et y ajoute le livre.
 */
async function addBookToShelf(url, cookie, csrfToken, shelfName, bookId) {
  let existing = await scrapeShelvesFromHomepage(url, cookie);
  let shelfId = existing.find(s => s.name === shelfName)?.id ?? null;

  if (!shelfId) {
    console.log(`[Calibre] Étagère "${shelfName}" introuvable — création...`);
    const params = new URLSearchParams({ title: shelfName, is_public: '0' });
    if (csrfToken) params.append('csrf_token', csrfToken);
    await axios.post(`${url}/shelf/create`, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookie,
        ...(csrfToken ? { 'X-CSRFToken': csrfToken } : {}),
      },
      timeout: TIMEOUT,
      validateStatus: s => s < 500,
    });

    existing = await scrapeShelvesFromHomepage(url, cookie);
    shelfId = existing.find(s => s.name === shelfName)?.id ?? null;
    if (!shelfId) throw new Error(`Impossible de créer l'étagère "${shelfName}"`);
  }

  const addParams = csrfToken ? new URLSearchParams({ csrf_token: csrfToken }).toString() : '';
  const addRes = await axios.post(`${url}/shelf/add/${shelfId}/${bookId}`, addParams, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookie,
      ...(csrfToken ? { 'X-CSRFToken': csrfToken } : {}),
    },
    timeout: TIMEOUT,
    validateStatus: s => s < 500,
  });

  if (addRes.status >= 400) {
    const body = typeof addRes.data === 'string'
      ? addRes.data.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
      : JSON.stringify(addRes.data).slice(0, 200);
    throw new Error(`Ajout à l'étagère échoué: HTTP ${addRes.status} — ${body}`);
  }
}

/**
 * Décode les entités XML/HTML de base (&amp; &#39; &#x27; etc.) — utilisé
 * pour les noms d'étagères et titres extraits par scraping.
 */
function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

/**
 * État réel d'appartenance d'un livre à ses étagères, interrogé côté
 * serveur Calibre-Web (pas notre propre enregistrement, qui peut être
 * périmé si le livre a été retiré d'une étagère directement dans Calibre).
 * - NextGen : GET /api/v1/books/{id}/shelves → { shelf_ids: [...] }, mappé
 *   en noms via la liste d'étagères déjà connue (shelvesWithIds).
 * - Classique : scrape de la page détail du livre, qui rend chaque étagère
 *   d'appartenance avec un attribut data-shelf-name directement exploitable.
 * Retourne un tableau de noms d'étagères, ou null si la vérification a
 * échoué (livre introuvable, page inaccessible…) pour laisser l'appelant
 * décider d'un repli plutôt que de faussement conclure "aucune étagère".
 */
export async function getBookShelfMembership(url, cookie, bookId, { flavorHint = '', shelvesWithIds = [] } = {}) {
  if (flavorHint !== 'classic') {
    try {
      const apiRes = await axios.get(`${url}/api/v1/books/${bookId}/shelves`, {
        headers: { Cookie: cookie, Accept: 'application/json' },
        timeout: TIMEOUT,
        validateStatus: s => s < 500,
      });
      if (apiRes.status === 200 && Array.isArray(apiRes.data?.shelf_ids)) {
        const idToName = new Map(shelvesWithIds.map(s => [s.id, s.name]));
        return apiRes.data.shelf_ids.map(id => idToName.get(id)).filter(Boolean);
      }
      if (apiRes.status !== 404) return null; // erreur inattendue, pas juste "pas NextGen"
    } catch {
      return null;
    }
  }

  try {
    const pageRes = await axios.get(`${url}/book/${bookId}`, {
      headers: { Cookie: cookie },
      timeout: TIMEOUT,
      validateStatus: s => s < 500,
    });
    if (pageRes.status !== 200 || typeof pageRes.data !== 'string') return null;

    const names = [];
    const re = /class="meta-pill meta-link shelf-pill"[\s\S]*?data-shelf-name="([^"]*)"/g;
    let m;
    while ((m = re.exec(pageRes.data)) !== null) {
      names.push(decodeHtmlEntities(m[1]));
    }
    return names;
  } catch {
    return null;
  }
}

/**
 * Ajoute un livre à plusieurs étagères. N'échoue pas globalement si une
 * étagère échoue individuellement — chaque échec est collecté séparément,
 * pour permettre un statut 'partial' distinguable d'un échec total.
 * Retourne { succeeded: [names], failed: [{ name, error }] }.
 */
export async function addToShelves(url, cookie, csrfToken, shelfNames, bookId) {
  const succeeded = [];
  const failed = [];
  for (const name of shelfNames) {
    const trimmed = name?.trim();
    if (!trimmed) continue;
    try {
      await addBookToShelf(url, cookie, csrfToken, trimmed, bookId);
      succeeded.push(trimmed);
    } catch (err) {
      failed.push({ name: trimmed, error: err.message });
    }
  }
  return { succeeded, failed };
}

/**
 * Retire un livre d'une étagère (par nom). Ne throw pas si le livre n'y
 * était déjà plus (statut 410 côté Calibre-Web) — traité comme un succès,
 * puisque l'état final souhaité (absent de cette étagère) est déjà atteint.
 * Ne throw pas non plus si l'étagère elle-même est introuvable (rien à retirer).
 */
async function removeBookFromShelf(url, cookie, csrfToken, shelfName, bookId) {
  const existing = await scrapeShelvesFromHomepage(url, cookie);
  const shelfId = existing.find(s => s.name === shelfName)?.id ?? null;
  if (!shelfId) return; // étagère absente côté serveur : rien à faire

  const removeParams = csrfToken ? new URLSearchParams({ csrf_token: csrfToken }).toString() : '';
  const removeRes = await axios.post(`${url}/shelf/remove/${shelfId}/${bookId}`, removeParams, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookie,
      ...(csrfToken ? { 'X-CSRFToken': csrfToken } : {}),
    },
    timeout: TIMEOUT,
    validateStatus: s => s < 500,
  });

  // 410 = déjà absent de l'étagère — pas une erreur du point de vue de l'appelant.
  if (removeRes.status >= 400 && removeRes.status !== 410) {
    const body = typeof removeRes.data === 'string'
      ? removeRes.data.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
      : JSON.stringify(removeRes.data).slice(0, 200);
    throw new Error(`Retrait de l'étagère échoué: HTTP ${removeRes.status} — ${body}`);
  }
}

/**
 * Réconcilie l'appartenance d'un livre à un ensemble d'étagères : calcule
 * le diff entre la sélection précédente et la nouvelle, ajoute les étagères
 * nouvellement cochées, retire celles décochées. Utilisée par le bouton
 * a posteriori du dashboard, où décocher une case doit avoir un effet réel
 * — contrairement au push initial (addToShelves), qui n'a jamais de
 * sélection précédente puisque le livre vient d'arriver.
 * Retourne { succeeded: [names ajoutées], removed: [names retirées], failed: [{ name, action, error }] }.
 */
export async function reconcileShelves(url, cookie, csrfToken, previousNames, targetNames, bookId) {
  const previous = new Set((previousNames || []).map(n => n?.trim()).filter(Boolean));
  const target = new Set((targetNames || []).map(n => n?.trim()).filter(Boolean));

  const toAdd = [...target].filter(n => !previous.has(n));
  const toRemove = [...previous].filter(n => !target.has(n));

  const succeeded = [];
  const removed = [];
  const failed = [];

  for (const name of toAdd) {
    try {
      await addBookToShelf(url, cookie, csrfToken, name, bookId);
      succeeded.push(name);
    } catch (err) {
      failed.push({ name, action: 'add', error: err.message });
    }
  }
  for (const name of toRemove) {
    try {
      await removeBookFromShelf(url, cookie, csrfToken, name, bookId);
      removed.push(name);
    } catch (err) {
      failed.push({ name, action: 'remove', error: err.message });
    }
  }

  return { succeeded, removed, failed };
}

/**
 * Pousse un livre déjà présent dans Calibre (calibreBookId connu) vers les
 * étagères d'un compte Calibre-Web cible — sans ré-upload. Se connecte avec
 * les identifiants propres à targetUser (chaque utilisateur a son propre
 * compte Calibre-Web), vérifie l'appartenance réelle côté serveur pour ne
 * pas se fier à un état potentiellement périmé, puis réconcilie vers la
 * sélection demandée. Utilisée pour le multishelf multi-utilisateurs (un
 * admin poussant un livre vers l'étagère de plusieurs comptes à la fois).
 * previousShelfNames sert de repli seulement si la vérification en direct
 * échoue (serveur inaccessible, etc.) — évite un retrait accidentel.
 * Retourne { succeeded, removed, failed } comme reconcileShelves.
 */
export async function pushBookToUserShelves(targetUser, calibreBookId, desiredShelfNames, previousShelfNames = []) {
  const cfg = targetUser?.calibreWeb;
  if (!cfg?.enabled || !cfg?.url) {
    throw new Error('Calibre-Web non configuré ou désactivé pour cet utilisateur');
  }

  const url = cfg.url.replace(/\/$/, '');
  const rawPassword = cfg.password || '';
  const password = decrypt(rawPassword) ?? rawPassword;
  if (!cfg.username || !password) throw new Error('Identifiants Calibre-Web manquants ou illisibles');

  const cookie = await getSessionCookie(url, cfg.username, password);

  let csrfToken = null;
  try {
    const page = await axios.get(`${url}/me`, {
      headers: { Cookie: cookie },
      timeout: TIMEOUT,
      validateStatus: s => s < 500,
    });
    const m = (page.data || '').match(/name="csrf_token"[^>]*value="([^"]+)"/);
    if (m) csrfToken = m[1];
  } catch {}

  const { shelves: knownShelves, detectedFlavor } = await listShelves(url, cookie, cfg.apiFlavor || '');
  const liveMembership = await getBookShelfMembership(url, cookie, calibreBookId, {
    flavorHint: cfg.apiFlavor || detectedFlavor,
    shelvesWithIds: knownShelves,
  });
  const basePrevious = liveMembership !== null ? liveMembership : previousShelfNames;

  return reconcileShelves(url, cookie, csrfToken, basePrevious, desiredShelfNames, calibreBookId);
}

/**
 * Résout le calibreBookId d'une demande (déjà connu, sinon retrouvé par
 * titre) — partagé entre la vérification en direct et l'envoi a posteriori
 * (self-service et multi-utilisateurs).
 */
export async function resolveCalibreBookId(request, url, username, password) {
  let calibreBookId = request.calibrePush?.calibreBookId || null;
  if (!calibreBookId) {
    calibreBookId = await matchCalibreBookId(url, username, password, request.title, { maxAttempts: 1 });
  }
  return calibreBookId;
}

/**
 * Recherche l'ID Calibre d'un livre déjà présent en bibliothèque par titre,
 * via /opds/search (recherche serveur sur toute la base — pas de fenêtre
 * temporelle à rater, contrairement à /opds/new). Utilisé aussi bien lors
 * de l'upload initial (Calibre-Web-Automated/NextGen, traitement async) que
 * pour retrouver a posteriori l'ID d'un livre dont on n'a pas encore la
 * référence stockée.
 */
export async function matchCalibreBookId(url, username, password, bookTitle, { maxAttempts = 4, retryDelayMs = 8000 } = {}) {
  if (!bookTitle) return null;

  const basicAuth = Buffer.from(`${username}:${password}`).toString('base64');
  const patterns = [
    /\/download\/(\d+)\//,
    /\/book\/(\d+)[/"]/,
    /calibre:(\d+)/,
    /\/opds\/book\/(\d+)/,
  ];

  // Decode les entites XML (&amp; &#39; &#x27; etc.) avant normalisation,
  // sinon un titre avec apostrophe/esperluette peut laisser des residus
  // numeriques parasites dans la comparaison (ex: "L'île" mal compare).
  const decodeXmlEntities = (str) => str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));

  const normalize = (str) => decodeXmlEntities(str).toLowerCase().replace(/[^a-z0-9]/g, '');
  const titleNorm = normalize(bookTitle);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const searchUrl = `${url}/opds/search/${encodeURIComponent(bookTitle)}`;
      const opdsRes = await axios.get(searchUrl, {
        headers: {
          Authorization: `Basic ${basicAuth}`,
          Accept: 'application/atom+xml, application/xml, text/xml',
        },
        timeout: TIMEOUT,
        validateStatus: s => s < 500,
      });

      if (opdsRes.status === 200 && typeof opdsRes.data === 'string') {
        const xml = opdsRes.data;
        const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
        let entry;
        let bestMatch = null; // { id, exact }

        while ((entry = entryRe.exec(xml)) !== null) {
          const entryXml = entry[1];
          const titleMatch = entryXml.match(/<title[^>]*>([\s\S]*?)<\/title>/);
          if (!titleMatch) continue;
          const entryTitleNorm = normalize(titleMatch[1]);

          const isExact = entryTitleNorm === titleNorm;
          const isFullInclusion = entryTitleNorm.includes(titleNorm) || titleNorm.includes(entryTitleNorm);

          if (isExact || (isFullInclusion && !bestMatch)) {
            let id = null;
            for (const pattern of patterns) {
              const m = entryXml.match(pattern);
              if (m) { id = parseInt(m[1], 10); break; }
            }
            if (id) {
              if (isExact) { bestMatch = { id, exact: true }; break; }
              if (!bestMatch) bestMatch = { id, exact: false };
            }
          }
        }

        if (bestMatch) {
          if (!bestMatch.exact) {
            console.warn(`[Calibre] Correspondance partielle (pas exacte) pour "${bookTitle}" — id ${bestMatch.id} retenu par defaut.`);
          }
          return bestMatch.id;
        }
      }
    } catch (err) {
      console.warn(`[Calibre] OPDS search erreur: ${err.message}`);
    }
    if (attempt < maxAttempts) await new Promise(r => setTimeout(r, retryDelayMs));
  }

  console.warn(`[Calibre] Livre "${bookTitle}" introuvable via /opds/search après ${maxAttempts} tentatives.`);
  return null;
}

/**
 * Push a file to Calibre-Web for the given user, puis ajoute le livre aux
 * étagères demandées (shelfNames). Si shelfNames est omis, retombe sur les
 * étagères par défaut du profil (utilisé par la resync manuelle).
 * Retourne { success: true, calibreBookId, shelfResult } ou throws.
 * shelfResult est null si aucune étagère n'était demandée, sinon
 * { succeeded, failed } — failed non-vide implique un statut 'partial'
 * côté appelant, pas un échec de la fonction.
 */
export async function pushToCalibre(user, filePath, bookTitle, shelfNames) {
  const cfg = user.calibreWeb;
  if (!cfg || !cfg.enabled || !cfg.url) return null;

  const url = cfg.url.replace(/\/$/, '');
  const username = cfg.username;
  const raw = cfg.password || '';
  const password = decrypt(raw) ?? raw; // fallback si ancien mot de passe en clair
  if (!username || !password) throw new Error('Identifiants Calibre-Web manquants ou illisibles');

  const effectiveShelfNames = shelfNames !== undefined
    ? shelfNames
    : (cfg.shelves || []).filter(s => s.isDefault).map(s => s.name);

  // 1. Login → session cookie
  const cookie = await getSessionCookie(url, username, password);

  // 2. CSRF token depuis /me
  let csrfToken = null;
  try {
    const page = await axios.get(`${url}/me`, {
      headers: { Cookie: cookie },
      timeout: TIMEOUT,
      validateStatus: s => s < 500,
    });
    const html = page.data || '';
    const m = html.match(/name="csrf_token"[^>]*value="([^"]+)"/)
           || html.match(/value="([^"]+)"[^>]*name="csrf_token"/);
    if (m) csrfToken = m[1];
  } catch {}
  if (!csrfToken) console.warn('[Calibre] CSRF token introuvable — upload risque d\'échouer');

  // 3. POST /upload
  const form = new FormData();
  form.append('btn-upload', fs.createReadStream(filePath), {
    filename: path.basename(filePath),
  });
  if (csrfToken) form.append('csrf_token', csrfToken);

  const uploadRes = await axios.post(`${url}/upload`, form, {
    headers: {
      ...form.getHeaders(),
      Cookie: cookie,
      ...(csrfToken ? { 'X-CSRFToken': csrfToken } : {}),
    },
    timeout: TIMEOUT,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    validateStatus: s => s < 500,
  });

  console.log(`[Calibre] POST /upload status: ${uploadRes.status}`);
  if (uploadRes.status >= 400) {
    const body = typeof uploadRes.data === 'string'
      ? uploadRes.data.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
      : JSON.stringify(uploadRes.data).slice(0, 300);
    console.error(`[Calibre] Réponse upload: ${body}`);
    const hint = uploadRes.status === 403
      ? 'Upload échoué: HTTP 403 — vérifiez que le compte Calibre-Web a la permission "Upload books" activée'
      : `Upload échoué: HTTP ${uploadRes.status}`;
    throw new Error(hint);
  }

  // 4. Extraire l'ID du livre
  let calibreBookId = null;
  const locationStr = String(uploadRes.data?.location || uploadRes.headers?.location || '');

  // Calibre-Web Automated / NextGen : traitement asynchrone → location = "/tasks"
  const isCWAAsync = locationStr === '/tasks';

  if (!isCWAAsync) {
    // Cas 1a : JSON { location: "/book/22" } ou { location: "/admin/book/22" }
    try {
      const m = locationStr.match(/\/book\/(\d+)/);
      if (m) calibreBookId = parseInt(m[1], 10);
    } catch {}

    // Cas 1b : JSON tableau [{ location: "/book/22" }]
    if (!calibreBookId) {
      try {
        const arr = Array.isArray(uploadRes.data) ? uploadRes.data : null;
        if (arr?.length) {
          const loc = arr[0]?.location || arr[0]?.url || '';
          const m = String(loc).match(/\/book\/(\d+)/);
          if (m) calibreBookId = parseInt(m[1], 10);
        }
      } catch {}
    }

    // Cas 1c : URL finale après redirection
    if (!calibreBookId) {
      try {
        const finalPath = uploadRes.request?.path || '';
        const m = finalPath.match(/\/book\/(\d+)/);
        if (m) calibreBookId = parseInt(m[1], 10);
      } catch {}
    }

    // Cas 1d : recherche par titre dans le HTML (fallback)
    if (!calibreBookId && bookTitle) {
      try {
        const searchRes = await axios.get(`${url}/search/${encodeURIComponent(bookTitle)}`, {
          headers: { Cookie: cookie },
          timeout: TIMEOUT,
          validateStatus: s => s < 500,
        });
        if (searchRes.status === 200 && typeof searchRes.data === 'string') {
          const m = searchRes.data.match(/href="\/book\/(\d+)"/);
          if (m) calibreBookId = parseInt(m[1], 10);
        }
      } catch {}
    }
  } else {
    console.log('[Calibre] CWA détecté — attente 8s puis recherche OPDS par titre...');
    await new Promise(r => setTimeout(r, 8000));
    calibreBookId = await matchCalibreBookId(url, username, password, bookTitle);
  }

  // 5. Ajout aux étagères demandées
  let shelfResult = null;
  if (effectiveShelfNames.length) {
    if (calibreBookId) {
      shelfResult = await addToShelves(url, cookie, csrfToken, effectiveShelfNames, calibreBookId);
      if (shelfResult.succeeded.length) {
        console.log(`[Calibre] Livre ${calibreBookId} ajouté à : ${shelfResult.succeeded.join(', ')}`);
      }
      if (shelfResult.failed.length) {
        console.warn(`[Calibre] Échec d'ajout à : ${shelfResult.failed.map(f => `${f.name} (${f.error})`).join(', ')}`);
      }
    } else {
      shelfResult = { succeeded: [], failed: effectiveShelfNames.map(name => ({ name, error: 'Book ID introuvable' })) };
      console.warn('[Calibre] Book ID introuvable — ajout étagères ignoré');
    }
  }

  return { success: true, calibreBookId, shelfResult };
}

/**
 * Test connectivity to a Calibre-Web instance.
 * Returns { connected: true, detectedFlavor } or { connected: false, error: string }.
 */
export async function testCalibreConnection({ url, username, password }) {
  if (!url) return { connected: false, error: 'URL manquante' };
  if (!username || !password) return { connected: false, error: 'Identifiants manquants' };

  const cleanUrl = url.replace(/\/$/, '');
  try {
    const cookie = await getSessionCookie(cleanUrl, username, password);

    // Vérifier la permission Upload via GET /upload
    const uploadCheck = await axios.get(`${cleanUrl}/upload`, {
      headers: { Cookie: cookie },
      timeout: TIMEOUT,
      maxRedirects: 0,
      validateStatus: s => s < 500,
    });

    // Détection du type de serveur (NextGen / classique), en profitant de la
    // session déjà ouverte — sert à pré-remplir apiFlavor côté route.
    let detectedFlavor = 'classic';
    try {
      const apiRes = await axios.get(`${cleanUrl}/api/v1/shelves`, {
        headers: { Cookie: cookie, Accept: 'application/json' },
        timeout: TIMEOUT,
        validateStatus: s => s < 500,
      });
      if (apiRes.status === 200 && apiRes.data && Array.isArray(apiRes.data.items)) {
        detectedFlavor = 'nextgen';
      }
    } catch {
      // Le scraping HTML restera le fallback à l'usage ; pas bloquant ici.
    }

    if (uploadCheck.status === 403) {
      return { connected: true, uploadAllowed: false, detectedFlavor, warning: 'Connexion réussie mais le compte n\'a pas la permission "Upload books" dans Calibre-Web.' };
    }

    return { connected: true, uploadAllowed: true, detectedFlavor };
  } catch (err) {
    const msg = err.response
      ? `HTTP ${err.response.status} — ${err.response.statusText}`
      : err.message;
    return { connected: false, error: msg };
  }
}
