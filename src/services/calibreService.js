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
  // 1. GET /login pour récupérer le CSRF token et le cookie de session initial
  const loginPage = await axios.get(`${url}/login`, {
    timeout: TIMEOUT,
    validateStatus: s => s < 500,
  });

  // Extraire le CSRF token depuis le HTML (<input name="csrf_token" value="...">)
  const csrfMatch = loginPage.data?.match(/name="csrf_token"[^>]*value="([^"]+)"/);
  const csrfToken = csrfMatch ? csrfMatch[1] : null;

  // Récupérer le cookie de session initial (nécessaire pour valider le CSRF)
  const initialCookies = (loginPage.headers['set-cookie'] || [])
    .map(c => c.split(';')[0])
    .join('; ');

  // 2. POST /login avec username, password et csrf_token
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

  // Succès = redirection 302 vers / avec nouveau cookie de session
  const setCookie = response.headers['set-cookie'];
  if (!setCookie || setCookie.length === 0) {
    throw new Error('Authentification Calibre-Web échouée : aucun cookie de session reçu');
  }

  // Combiner cookies initiaux + cookies de session post-login
  const allCookies = [
    ...initialCookies.split('; ').filter(Boolean),
    ...setCookie.map(c => c.split(';')[0]),
  ];
  return [...new Set(allCookies)].join('; ');
}

/**
 * Push a file to Calibre-Web for the given user.
 * user.calibreWeb fields (apiKey and password) are stored encrypted.
 * Returns { success: true } or throws an Error.
 */
export async function pushToCalibre(user, filePath, bookTitle) {
  const cfg = user.calibreWeb;
  if (!cfg || !cfg.enabled || !cfg.url) return null;

  const url = cfg.url.replace(/\/$/, '');
  const username = cfg.username;
  const password = decrypt(cfg.password);
  if (!username || !password) throw new Error('Identifiants Calibre-Web manquants ou illisibles');

  // 1. Login → session cookie
  const cookie = await getSessionCookie(url, username, password);

  // 2. Récupérer le CSRF token depuis la page principale (GET /upload = 405)
  let csrfToken = null;
  // Le token CSRF se trouve sur /me (page profil utilisateur)
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

  // 3. POST /upload avec le fichier + csrf_token (champ ET header)
  const form = new FormData();
  form.append('btn-upload', fs.createReadStream(filePath), {
    filename: path.basename(filePath),
  });
  if (csrfToken) form.append('csrf_token', csrfToken);

  const uploadHeaders = {
    ...form.getHeaders(),
    Cookie: cookie,
    ...(csrfToken ? { 'X-CSRFToken': csrfToken } : {}),
  };

  const uploadRes = await axios.post(`${url}/upload`, form, {
    headers: uploadHeaders,
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

  // Extraire l'ID du livre depuis la réponse JSON { location: "/admin/book/22" }
  // ou depuis l'URL finale après redirection (/book/{id})
  let calibreBookId = null;
  try {
    // Cas 1 : réponse JSON avec champ location (Calibre-Web >= 0.6.x)
    const location = uploadRes.data?.location || uploadRes.headers?.location || '';
    const m = location.match(/\/book\/(\d+)/);
    if (m) calibreBookId = parseInt(m[1], 10);
  } catch {}

  // Cas 2 : fallback sur l'URL finale de la requête (redirection suivie)
  if (!calibreBookId) {
    try {
      const finalPath = uploadRes.request?.path || '';
      const m = finalPath.match(/\/book\/(\d+)/);
      if (m) calibreBookId = parseInt(m[1], 10);
    } catch {}
  }

  // Ajout à l'étagère Kobo si configurée
  if (calibreBookId && cfg.shelfName?.trim()) {
    try {
      await addBookToShelf(url, cookie, csrfToken, cfg.shelfName.trim(), calibreBookId);
      console.log(`[Calibre] Livre ${calibreBookId} ajouté à l'étagère "${cfg.shelfName}"`);
    } catch (err) {
      // Non-bloquant : l'upload est un succès même si l'ajout à l'étagère échoue
      console.warn(`[Calibre] Ajout étagère échoué: ${err.message}`);
    }
  } else if (cfg.shelfName?.trim()) {
    console.warn(`[Calibre] Shelf skippé — impossible d'extraire l'ID du livre après upload`);
  }

  return { success: true, calibreBookId };
}

/**
 * Trouve (ou crée) une étagère par nom et y ajoute le livre.
 */
async function addBookToShelf(url, cookie, csrfToken, shelfName, bookId) {
  // 1. Trouver l'ID de l'étagère depuis la homepage (liens /shelf/{id})
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
      // Supprimer balises HTML et compteur suffixé (ex: "kobo-sync 0" → "kobo-sync")
      const name = match[2].replace(/<[^>]+>/g, '').replace(/\s+\d+$/, '').trim();
      if (name === shelfName) {
        shelfId = parseInt(match[1], 10);
        break;
      }
    }
  }

  // 2. Si introuvable, créer l'étagère puis relire la homepage pour récupérer son ID
  if (!shelfId) {
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

    // Relire la homepage pour trouver l'ID de la nouvelle étagère
    const recheckRes = await axios.get(`${url}/`, {
      headers: { Cookie: cookie },
      timeout: TIMEOUT,
      validateStatus: s => s < 500,
    });
    if (recheckRes.status === 200 && typeof recheckRes.data === 'string') {
      const re2 = /href="\/shelf\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g;
      let m2;
      while ((m2 = re2.exec(recheckRes.data)) !== null) {
        const name = m2[2].replace(/<[^>]+>/g, '').replace(/\s+\d+$/, '').trim();
        if (name === shelfName) { shelfId = parseInt(m2[1], 10); break; }
      }
    }
    if (!shelfId) throw new Error(`Impossible de créer l'étagère "${shelfName}"`);
  }

  // 3. Ajouter le livre : POST /shelf/add/{shelf_id}/{book_id}
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
    throw new Error(`Ajout à l'étagère échoué: HTTP ${addRes.status}`);
  }
}

/**
 * Test connectivity to a Calibre-Web instance.
 * calibreConfig fields are in plaintext (pre-save test from frontend).
 * Returns { connected: true } or { connected: false, error: string }.
 */
export async function testCalibreConnection({ url, username, password }) {
  if (!url) return { connected: false, error: 'URL manquante' };
  if (!username || !password) return { connected: false, error: 'Identifiants manquants' };

  const cleanUrl = url.replace(/\/$/, '');
  try {
    // Si getSessionCookie réussit sans exception, le login est valide
    await getSessionCookie(cleanUrl, username, password);
    return { connected: true };
  } catch (err) {
    const msg = err.response
      ? `HTTP ${err.response.status} — ${err.response.statusText}`
      : err.message;
    return { connected: false, error: msg };
  }
}