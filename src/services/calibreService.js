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

  return { success: true };
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
