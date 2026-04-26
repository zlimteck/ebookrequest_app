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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_URL = 'https://valentine.wtf';

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:124.0) Gecko/20100101 Firefox/124.0',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
};

async function getConfig() {
  const doc = await ConnectorSettings.findOne({ service: 'valentine' }).lean();
  return doc || { enabled: false, url: DEFAULT_URL, username: '', password: '' };
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
  // 1. GET homepage to extract lsID token
  const homeRes = await axios.get(`${baseUrl}/`, {
    headers: BASE_HEADERS,
    timeout: 25000,
    maxRedirects: 5,
    validateStatus: () => true,
  });

  const lsIdMatch = homeRes.data.match(/name=["']lsID["']\s+value=["']([^"']+)["']/);
  const lsId = lsIdMatch ? lsIdMatch[1] : '';
  const cookies = parseCookies(homeRes.headers['set-cookie']);

  // 2. POST credentials
  const formData = new URLSearchParams({ pseudo: username, password, lsID: lsId });
  const loginRes = await axios.post(
    `${baseUrl}/includes/login_verif.php?action=login&type=user`,
    formData.toString(),
    {
      headers: {
        ...BASE_HEADERS,
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

  const allCookies = { ...cookies, ...parseCookies(loginRes.headers['set-cookie']) };

  if (!allCookies.hash_m) {
    throw new Error('Identifiants invalides — cookie hash_m absent (connexion refusée)');
  }

  return allCookies;
}

/**
 * Search ebooks by title/author term.
 * @param {string} baseUrl
 * @param {object} cookies
 * @param {string} query
 * @returns {Promise<Array>} list of { id, title, url }
 */
async function searchTitles(baseUrl, cookies, query) {
  const res = await axios.get(`${baseUrl}/includes/recherche.php`, {
    params: { type: 'global', term: query, contenu: 'search_ebooks' },
    headers: {
      ...BASE_HEADERS,
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      'Cookie': cookieHeader(cookies),
    },
    timeout: 20000,
  });

  const data = Array.isArray(res.data) ? res.data : [];
  const results = [];
  for (const item of data) {
    if (!item.value || !item.id) continue;
    if (item.txt?.includes('Cliquez ici')) continue;
    results.push({ id: String(item.id), title: item.value, url: item.url || '' });
  }
  return results;
}

/**
 * Get the download path from the ebook modal.
 * @param {string} baseUrl
 * @param {object} cookies
 * @param {string} bookId
 * @returns {Promise<string|null>} relative path like /includes/telechargement.php?...
 */
async function getDownloadPath(baseUrl, cookies, bookId) {
  const res = await axios.post(
    `${baseUrl}/pages/eBookModalNew.php`,
    new URLSearchParams({ ebook_id: bookId, downloaded: '0' }).toString(),
    {
      headers: {
        ...BASE_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookieHeader(cookies),
      },
      timeout: 20000,
      validateStatus: () => true,
    }
  );

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
export async function testConnectionValentine(username, password) {
  const baseUrl = DEFAULT_URL;
  await login(baseUrl, username, password);
  return true;
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
export async function downloadFromValentine(title, author, requestId, category = 'ebook') {
  try {
    const isMangaOrComic = category === 'comic' || category === 'manga' ||
      /\b(manga|manhwa|manhua|comic|tome\s*\d+|vol\.?\s*\d+|t\d{2}\b)/i.test(title);

    if (isMangaOrComic) {
      console.log(`[Valentine] "${title}" est un comic/manga, skip.`);
      return;
    }

    const config = await getConfig();
    if (!config.enabled || !config.username || !config.password) {
      console.log('[Valentine] Désactivé ou config incomplète, skip.');
      return;
    }

    const baseUrl = (config.url || DEFAULT_URL).replace(/\/$/, '');

    // ── Login ──────────────────────────────────────────────────────────────
    let cookies;
    try {
      cookies = await login(baseUrl, config.username, config.password);
    } catch (err) {
      console.error('[Valentine] Erreur de connexion:', err.message);
      return;
    }

    // ── Search ─────────────────────────────────────────────────────────────
    const cleanTitle = title
      .replace(/\s*[-–—:]\s+.*/u, '')
      .replace(/\s*tome\s+\d+.*/i, '')
      .replace(/\s*vol\.?\s+\d+.*/i, '')
      .replace(/\s*\(.*\)\s*/g, '')
      .trim();

    const queries = [`${cleanTitle} ${author}`.trim(), cleanTitle];

    let book = null;
    for (const q of queries) {
      const results = await searchTitles(baseUrl, cookies, q);
      if (results.length) {
        book =
          results.find(r => r.title.toLowerCase() === cleanTitle.toLowerCase()) ||
          results[0];
        break;
      }
    }

    if (!book) {
      console.log(`[Valentine] Aucun résultat pour "${title}"`);
      return;
    }

    // ── Download link ──────────────────────────────────────────────────────
    const dlPath = await getDownloadPath(baseUrl, cookies, book.id);
    if (!dlPath) {
      console.log(`[Valentine] Lien de téléchargement introuvable pour "${book.title}"`);
      return;
    }

    // ── Download file ──────────────────────────────────────────────────────
    const fullUrl = `${baseUrl}${dlPath}`;
    const fileRes = await axios.get(fullUrl, {
      headers: {
        ...BASE_HEADERS,
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
}