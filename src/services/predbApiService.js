import fetch from 'node-fetch';
import ConnectorSettings from '../models/ConnectorSettings.js';
import { decrypt } from './cryptoService.js';
import { extractBookInfo, calculateMatchScore } from './rssService.js';

const DEFAULT_URL = 'https://api.predb.fr';
const EBOOK_CATEGORY = 'Ebooks';

async function getConfig() {
  const doc = await ConnectorSettings.findOne({ service: 'predb' }).lean();
  if (!doc) return { enabled: false, url: DEFAULT_URL, apiKey: '' };
  const raw = doc.apiKey || '';
  return { ...doc, apiKey: decrypt(raw) ?? raw };
}

export async function pingPredbApi() {
  const config = await getConfig();
  if (!config.enabled) return { enabled: false, connected: false, error: null };
  if (!config.apiKey) return { enabled: true, connected: false, error: 'Clé API non configurée' };

  const baseUrl = (config.url || DEFAULT_URL).replace(/\/$/, '');
  try {
    const res = await fetch(`${baseUrl}/api/v1/me`, {
      headers: {
        'X-API-Key': config.apiKey,
        'User-Agent': 'Mozilla/5.0 (compatible; EbookRequest/1.0)',
      },
      timeout: 8000,
    });
    if (res.status === 401) throw new Error('Clé API invalide');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const username = data.user?.username || data.username || data.user?.email || data.email || null;
    return { enabled: true, connected: true, username, error: null };
  } catch (err) {
    return { enabled: true, connected: false, error: err.message };
  }
}

export async function checkBookAvailabilityViaApi(title, author) {
  try {
    const config = await getConfig();
    if (!config.enabled || !config.apiKey) return null;

    const baseUrl = (config.url || DEFAULT_URL).replace(/\/$/, '');
    const headers = {
      'X-API-Key': config.apiKey,
      'User-Agent': 'Mozilla/5.0 (compatible; EbookRequest/1.0)',
    };

    const searchTerms = [
      author,
      title.split(' ').slice(0, 3).join(' '),
    ].filter(t => t && t.length > 2);

    const seenNames = new Set();
    const allItems = [];

    for (const term of searchTerms) {
      try {
        const url = `${baseUrl}/api/v1/releases?q=${encodeURIComponent(term)}&cat=${EBOOK_CATEGORY}&limit=50`;
        const res = await fetch(url, { headers, timeout: 10000 });
        if (!res.ok) continue;
        const data = await res.json();
        const items = Array.isArray(data) ? data : (Array.isArray(data?.releases) ? data.releases : []);
        for (const item of items) {
          if (item.name && !seenNames.has(item.name)) {
            seenNames.add(item.name);
            allItems.push(item);
          }
        }
      } catch (e) {
        console.log(`[PreDB API] Erreur pour "${term}":`, e.message);
      }
    }

    if (!allItems.length) return { available: false, confidence: 'low', score: 0, match: null };

    let bestMatch = null;
    let bestScore = 0;

    for (const item of allItems) {
      const { title: extractedTitle, author: extractedAuthor, fullText } = extractBookInfo(item.name);
      const score = calculateMatchScore(title, author, extractedTitle, extractedAuthor, fullText);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = { rssTitle: item.name, extractedTitle, extractedAuthor, score };
      }
    }

    return {
      available: bestScore >= 45,
      confidence: bestScore >= 75 ? 'high' : bestScore >= 45 ? 'medium' : 'low',
      match: bestMatch,
      score: bestScore,
    };
  } catch {
    return null;
  }
}