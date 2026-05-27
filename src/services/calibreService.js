import axios from 'axios';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
import { decrypt } from './cryptoService.js';

const TIMEOUT = 30000;

/**
 * Obtain a session cookie for password-based auth.
 * Calibre-Web uses Flask-WTF → requires a CSRF token extracted from the login page.
 */
async function getSessionCookie(url, username, password) {
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
 * Push a file to Calibre-Web for the given user.
 * Returns { success: true } or throws an Error.
 */
export async function pushToCalibre(user, filePath, bookTitle) {
  const cfg = user.calibreWeb;
  if (!cfg || !cfg.enabled || !cfg.url) return null;

  const url = cfg.url.replace(/\/$/, '');
  const username = cfg.username;
  const raw = cfg.password || '';
  const password = decrypt(raw) ?? raw; // fallback si ancien mot de passe en clair
  if (!username || !password) throw new Error('Identifiants Calibre-Web manquants ou illisibles');

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
    throw new Error(`Upload échoué: HTTP ${uploadRes.status}`);
  }

  // 4. Extraire l'ID du livre
  let calibreBookId = null;
  const locationStr = String(uploadRes.data?.location || uploadRes.headers?.location || '');

  // Calibre-Web Automated : traitement asynchrone → location = "/tasks"
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
    // Calibre-Web Automated : attendre puis lire le flux OPDS (XML pur)
    console.log('[Calibre] CWA détecté — attente 15s puis lecture OPDS...');
    await new Promise(r => setTimeout(r, 15000));
    const basicAuth = Buffer.from(`${username}:${password}`).toString('base64');
    const patterns = [
      /\/download\/(\d+)\//,
      /\/book\/(\d+)[/"]/,
      /calibre:(\d+)/,
      /\/opds\/book\/(\d+)/,
    ];
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const opdsRes = await axios.get(`${url}/opds/new`, {
          headers: {
            Authorization: `Basic ${basicAuth}`,
            Accept: 'application/atom+xml, application/xml, text/xml',
          },
          timeout: TIMEOUT,
          validateStatus: s => s < 500,
        });
        if (opdsRes.status === 200 && typeof opdsRes.data === 'string') {
          const xml = opdsRes.data;

          // Chercher d'abord l'entrée dont le <title> correspond au livre uploadé
          if (bookTitle) {
            const titleNorm = bookTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
            const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
            let entry;
            while ((entry = entryRe.exec(xml)) !== null) {
              const entryXml = entry[1];
              const titleMatch = entryXml.match(/<title[^>]*>([\s\S]*?)<\/title>/);
              if (!titleMatch) continue;
              const entryTitle = titleMatch[1].toLowerCase().replace(/[^a-z0-9]/g, '');
              // Correspondance si le titre du feed contient au moins 6 caractères du titre recherché
              const minLen = Math.min(titleNorm.length, 6);
              if (entryTitle.includes(titleNorm.slice(0, minLen)) || titleNorm.includes(entryTitle.slice(0, minLen))) {
                for (const pattern of patterns) {
                  const m = entryXml.match(pattern);
                  if (m) { calibreBookId = parseInt(m[1], 10); break; }
                }
                if (calibreBookId) break;
              }
            }
          }

          // Fallback : premier ID trouvé dans le feed si pas de correspondance par titre
          if (!calibreBookId) {
            for (const pattern of patterns) {
              const m = xml.match(pattern);
              if (m) { calibreBookId = parseInt(m[1], 10); break; }
            }
          }
        }
      } catch (err) {
        console.warn(`[Calibre] OPDS erreur: ${err.message}`);
      }
      if (calibreBookId) break;
      if (attempt < 4) await new Promise(r => setTimeout(r, 8000));
    }
  }

  // 5. Ajout à l'étagère Kobo si configurée
  if (calibreBookId && cfg.shelfName?.trim()) {
    try {
      await addBookToShelf(url, cookie, csrfToken, cfg.shelfName.trim(), calibreBookId);
      console.log(`[Calibre] Livre ${calibreBookId} ajouté à l'étagère "${cfg.shelfName}"`);
    } catch (err) {
      console.warn(`[Calibre] Ajout étagère échoué: ${err.message}`);
    }
  } else if (!calibreBookId && cfg.shelfName?.trim()) {
    console.warn('[Calibre] Book ID introuvable — ajout étagère ignoré');
  }

  return { success: true, calibreBookId };
}

/**
 * Trouve (ou crée) une étagère par nom et y ajoute le livre.
 */
async function addBookToShelf(url, cookie, csrfToken, shelfName, bookId) {
  // Normalise le nom d'une étagère : retire les suffixes " (N)" ou " N" (compteur de livres)
  const normalizeName = (raw) =>
    raw.replace(/<[^>]+>/g, '').replace(/\s+\(\d+\)$/, '').replace(/\s+\d+$/, '').trim();

  // 1. Chercher l'étagère dans la homepage
  const homeRes = await axios.get(`${url}/`, {
    headers: { Cookie: cookie },
    timeout: TIMEOUT,
    validateStatus: s => s < 500,
  });

  let shelfId = null;
  if (homeRes.status === 200 && typeof homeRes.data === 'string') {
    const re = /href="\/shelf\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    while ((match = re.exec(homeRes.data)) !== null) {
      if (normalizeName(match[2]) === shelfName) {
        shelfId = parseInt(match[1], 10);
        break;
      }
    }
  }

  // 2. Créer l'étagère si introuvable
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

    const recheckRes = await axios.get(`${url}/`, {
      headers: { Cookie: cookie },
      timeout: TIMEOUT,
      validateStatus: s => s < 500,
    });
    if (recheckRes.status === 200 && typeof recheckRes.data === 'string') {
      const re2 = /href="\/shelf\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g;
      let m2;
      while ((m2 = re2.exec(recheckRes.data)) !== null) {
        if (normalizeName(m2[2]) === shelfName) { shelfId = parseInt(m2[1], 10); break; }
      }
    }
    if (!shelfId) throw new Error(`Impossible de créer l'étagère "${shelfName}"`);
  }

  // 3. Ajouter le livre
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
 * Test connectivity to a Calibre-Web instance.
 * Returns { connected: true } or { connected: false, error: string }.
 */
export async function testCalibreConnection({ url, username, password }) {
  if (!url) return { connected: false, error: 'URL manquante' };
  if (!username || !password) return { connected: false, error: 'Identifiants manquants' };

  const cleanUrl = url.replace(/\/$/, '');
  try {
    await getSessionCookie(cleanUrl, username, password);
    return { connected: true };
  } catch (err) {
    const msg = err.response
      ? `HTTP ${err.response.status} — ${err.response.statusText}`
      : err.message;
    return { connected: false, error: msg };
  }
}
