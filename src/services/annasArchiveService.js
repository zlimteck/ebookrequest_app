import axios from 'axios';
import ConnectorSettings from '../models/ConnectorSettings.js';

const FALLBACK_URLS = [
  'https://annas-archive.pk',
  'https://annas-archive.gl',
  'https://annas-archive.gd',
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:124.0) Gecko/20100101 Firefox/124.0',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
};

async function getConfig() {
  const doc = await ConnectorSettings.findOne({ service: 'annasarchive' }).lean();
  return doc || { enabled: false, url: FALLBACK_URLS[0] };
}

/**
 * Try primary URL first, then fallbacks, return first working base URL.
 */
async function getWorkingUrl(primaryUrl) {
  const candidates = [
    primaryUrl,
    ...FALLBACK_URLS.filter(u => u !== primaryUrl),
  ];
  for (const url of candidates) {
    try {
      const res = await axios.get(`${url}/`, {
        headers: HEADERS,
        timeout: 8000,
        validateStatus: s => s < 500,
      });
      if (res.status === 200) return url;
    } catch {}
  }
  throw new Error('Aucun serveur Anna\'s Archive joignable (pk, gl, gd)');
}

/**
 * Strip HTML tags and decode common entities.
 */
function stripHtml(str) {
  return str
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse search results HTML into structured objects.
 */
function parseResults(html, baseUrl) {
  const results = [];

  // Split by result blocks (each starts with the flex container)
  const blocks = html.split('<div class="flex  pt-3');

  for (const block of blocks.slice(1)) {
    // MD5 hash — appears in first href="/md5/..."
    const md5Match = block.match(/href="\/md5\/([a-f0-9]{32})"/);
    if (!md5Match) continue;
    const md5 = md5Match[1];

    // Title — from data-content on fallback cover div (always present even when cover loads)
    const titleMatch = block.match(/text-violet-900[^>]+data-content="([^"]+)"/);
    const title = titleMatch ? titleMatch[1].trim() : null;
    if (!title) continue;

    // Author — from data-content on fallback author div
    const authorMatch = block.match(/text-amber-900[^>]+data-content="([^"]+)"/);
    const author = authorMatch ? authorMatch[1].trim() : null;

    // Cover image — src from the object-cover img
    const coverMatch = block.match(/class="[^"]*object-cover[^"]*"[^>]+src="([^"]+)"/);
    const cover = coverMatch ? coverMatch[1] : null;

    // File info: find text node with "· FORMAT · SIZE" pattern (e.g. "English [en] · EPUB · 1.0MB · 1964")
    // The text appears right after a tag with font-semibold and before the next tag
    const fileInfoMatch = block.match(/font-semibold[^>]*>([^<]{10,200}·[^<]{3,})/);
    let format = null, size = null, lang = null, year = null;
    if (fileInfoMatch) {
      const raw = fileInfoMatch[1].replace(/[^\x20-\x7E\s·]/g, '').trim();
      const parts = raw.split('·').map(p => p.trim()).filter(Boolean);
      lang   = parts[0] || null;                                           // "English [en]"
      format = parts[1] || null;                                           // "EPUB"
      size   = parts[2] || null;                                           // "1.0MB"
      year   = parts.find(p => /^\d{4}$/.test(p)) || null;               // "1964"
    }

    results.push({
      md5,
      title,
      author,
      cover,
      format,
      size,
      lang,
      year,
      annaUrl: `${baseUrl}/md5/${md5}`,
    });
  }

  return results;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Search Anna's Archive and return enriched results.
 */
export async function searchOnAnnasArchive(query) {
  const config = await getConfig();
  if (!config.enabled) throw new Error('Connecteur Anna\'s Archive désactivé');

  const baseUrl = await getWorkingUrl((config.url || FALLBACK_URLS[0]).replace(/\/$/, ''));

  const res = await axios.get(`${baseUrl}/search`, {
    params: { q: query },
    headers: HEADERS,
    timeout: 20000,
  });

  const results = parseResults(res.data, baseUrl);
  return { results, baseUrl };
}

/**
 * GET / PUT config for Anna's Archive connector.
 */
export async function getAnnasArchiveConfig() {
  const doc = await ConnectorSettings.findOne({ service: 'annasarchive' }).lean();
  return doc || { service: 'annasarchive', enabled: false, url: FALLBACK_URLS[0] };
}

export async function saveAnnasArchiveConfig({ enabled, url }) {
  const doc = await ConnectorSettings.findOneAndUpdate(
    { service: 'annasarchive' },
    { enabled: !!enabled, url: url?.trim() || FALLBACK_URLS[0] },
    { upsert: true, new: true, runValidators: true }
  );
  return doc;
}