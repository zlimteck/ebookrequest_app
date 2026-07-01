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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || 'http://flaresolverr:8191';

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
  return Promise.any(
    candidates.map(url =>
      axios.get(`${url}/`, {
        headers: HEADERS,
        timeout: 8000,
        validateStatus: s => s < 500,
      }).then(res => {
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
        return url;
      })
    )
  ).catch(() => {
    throw new Error('Aucun serveur Anna\'s Archive joignable (pk, gl, gd)');
  });
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

  const blocks = html.split('<div class="flex  pt-3');

  for (const block of blocks.slice(1)) {
    const md5Match = block.match(/href="\/md5\/([a-f0-9]{32})"/);
    if (!md5Match) continue;
    const md5 = md5Match[1];

    const titleMatch = block.match(/text-violet-900[^>]+data-content="([^"]+)"/);
    const title = titleMatch ? titleMatch[1].trim() : null;
    if (!title) continue;

    const authorMatch = block.match(/text-amber-900[^>]+data-content="([^"]+)"/);
    const author = authorMatch ? authorMatch[1].trim() : null;

    const coverMatch = block.match(/class="[^"]*object-cover[^"]*"[^>]+src="([^"]+)"/);
    const cover = coverMatch ? coverMatch[1] : null;

    const fileInfoMatch = block.match(/font-semibold[^>]*>([^<]{10,200}·[^<]{3,})/);
    let format = null, size = null, lang = null, year = null;
    if (fileInfoMatch) {
      const raw = fileInfoMatch[1].replace(/[^\x20-\x7E\s·]/g, '').trim();
      const parts = raw.split('·').map(p => p.trim()).filter(Boolean);
      lang   = parts[0] || null;
      format = parts[1]?.toLowerCase() || null;
      size   = parts[2] || null;
      year   = parts.find(p => /^\d{4}$/.test(p)) || null;
      // Ignorer les valeurs non-ebook (ex: "English [en]" mal parsé)
      if (format && !KNOWN_EBOOK_EXTS.has(format.replace(/[^a-z0-9]/g, ''))) format = null;
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

// ─── FlareSolverr ─────────────────────────────────────────────────────────────

/**
 * Fetch une URL via FlareSolverr (bypass DDoS-Guard/Cloudflare).
 * Retourne { html, finalUrl }.
 */
async function cfFetch(url, maxTimeout = 60000) {
  console.log(`[Annas] FlareSolverr → ${url}`);
  const res = await axios.post(
    `${FLARESOLVERR_URL}/v1`,
    { cmd: 'request.get', url, maxTimeout },
    { timeout: maxTimeout + 15000 }
  );
  if (res.data?.status !== 'ok') {
    throw new Error(`FlareSolverr erreur: ${res.data?.message || 'unknown'}`);
  }
  return {
    html:     res.data.solution?.response || '',
    finalUrl: res.data.solution?.url || url,
  };
}

/**
 * Télécharge depuis une page libgen ads.php (libgen.li / libgen.rs).
 * Ces sites n'ont pas de DDoS-Guard — on peut les fetcher directement.
 * Parse le HTML pour trouver le lien get.php?md5=...&key=... puis télécharge.
 */
async function downloadFromAdsPage(adsUrl) {
  const res = await axios.get(adsUrl, {
    headers: HEADERS,
    timeout: 20000,
    maxRedirects: 5,
    validateStatus: s => s < 400,
  });
  const html = typeof res.data === 'string' ? res.data : '';

  // 1. Lien get.php (libgen.li / libgen.rs)
  const getMatch = html.match(/href="((?:[^"]*\/)?get\.php\?[^"]+)"/i);
  if (getMatch) {
    let getUrl = getMatch[1];
    if (!getUrl.startsWith('http')) {
      const base = new URL(adsUrl);
      getUrl = getUrl.startsWith('/') ? `${base.origin}${getUrl}` : `${base.origin}/${getUrl}`;
    }
    console.log(`[Annas] ads → get.php: ${getUrl}`);
    return directDownload(getUrl, HEADERS['User-Agent']);
  }

  // 2. Lien CDN direct dans le HTML
  const fileUrl = extractFileUrlFromHtml(html);
  if (fileUrl) {
    console.log(`[Annas] ads → CDN: ${fileUrl}`);
    return directDownload(fileUrl, HEADERS['User-Agent']);
  }

  throw new Error('Aucun lien de téléchargement trouvé dans la page partenaire');
}

/**
 * Parse the MD5 detail page and extract candidate download links.
 * Priority: libgen.li/rs (ads.php) > slow_download > other partners.
 */
function parseDownloadLinks(html, baseUrl) {
  const links = [];

  // Anna's Archive slow_download path — /slow_download/...
  const slowMatches = html.matchAll(/href="(\/slow_download\/[^"?#]+)"/g);
  for (const m of slowMatches) {
    links.push({ type: 'slow', url: `${baseUrl}${m[1]}` });
  }

  // Libgen ads pages (libgen.li/ads.php, libgen.rs/ads.php) — pas de DDoS-Guard, parsing nécessaire
  const adsPattern = /href="(https?:\/\/(?:libgen\.li|libgen\.rs)[^"]*ads\.php[^"]*)"/g;
  for (const m of html.matchAll(adsPattern)) {
    links.push({ type: 'ads', url: m[1] });
  }

  // Autres liens partenaires directs (get.php direct, etc.)
  const extPattern = /href="(https?:\/\/(?:libgen\.li|libgen\.rs|z-lib\.[a-z]+|archive\.org)[^"]*(?:get\.php|download)[^"]*)"/g;
  for (const m of html.matchAll(extPattern)) {
    if (!links.some(l => l.url === m[1])) {
      links.push({ type: 'partner', url: m[1] });
    }
  }

  return links;
}

/**
 * Try to download a file directly (no challenge). Returns { buffer, filename }.
 */
function fmtBytes(bytes) {
  return bytes >= 1048576
    ? `${(bytes / 1048576).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(0)} KB`;
}

function fmtSpeed(bytesPerSec) {
  return bytesPerSec >= 1048576
    ? `${(bytesPerSec / 1048576).toFixed(1)} MB/s`
    : `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
}

async function directDownload(url, userAgent) {
  const headers = {
    ...HEADERS,
    'User-Agent': userAgent || HEADERS['User-Agent'],
  };

  const res = await axios.get(url, {
    headers,
    responseType: 'stream',
    timeout: 45000,       // timeout connexion initiale uniquement
    maxRedirects: 10,
    validateStatus: s => s < 400,
  });

  const contentType = res.headers['content-type'] || '';
  if (contentType.includes('text/html')) {
    res.data.destroy();
    throw new Error('Réponse HTML reçue, pas un fichier');
  }
  const badMimes = ['text/css', 'text/javascript', 'application/javascript', 'image/svg', 'font/'];
  if (badMimes.some(t => contentType.includes(t))) {
    res.data.destroy();
    throw new Error(`Type MIME non-ebook reçu: ${contentType.split(';')[0].trim()}`);
  }

  const totalSize = parseInt(res.headers['content-length'] || '0', 10);

  // 1. Nom depuis Content-Disposition
  const cd = res.headers['content-disposition'] || '';
  const fnMatch = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)["']?/i);
  let filename = fnMatch ? decodeURIComponent(fnMatch[1].trim()) : null;

  // 2. Fallback : extraire le nom depuis l'URL (contient souvent l'extension correcte)
  if (!filename || !path.extname(filename)) {
    try {
      const urlPath = decodeURIComponent(new URL(url).pathname);
      const urlBasename = path.basename(urlPath);
      const knownExts = ['.epub', '.mobi', '.pdf', '.cbz', '.cbr', '.azw3', '.fb2', '.djvu', '.zip'];
      if (knownExts.includes(path.extname(urlBasename).toLowerCase())) {
        filename = filename || urlBasename;
        console.log(`[Annas] Nom extrait de l'URL: ${urlBasename}`);
      }
    } catch {}
  }

  const totalStr = totalSize ? fmtBytes(totalSize) : '?';
  console.log(`[Annas] Début téléchargement — taille: ${totalStr}`);

  return new Promise((resolve, reject) => {
    const chunks = [];
    let downloaded = 0;
    const startTime = Date.now();
    let lastLogTime = Date.now();
    let lastLogBytes = 0;
    let stallTimer = null;
    const STALL_TIMEOUT = 30000; // 30s sans données = stall

    const resetStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        res.data.destroy(new Error('Téléchargement bloqué — aucune donnée depuis 30s'));
      }, STALL_TIMEOUT);
    };

    resetStall();

    res.data.on('data', chunk => {
      resetStall();
      chunks.push(chunk);
      downloaded += chunk.length;

      const now = Date.now();
      const elapsed = (now - lastLogTime) / 1000;
      if (elapsed >= 10) {
        const speed = (downloaded - lastLogBytes) / elapsed;
        const pct = totalSize ? `${Math.round((downloaded / totalSize) * 100)}%` : '?%';
        console.log(`[Annas] ↓ ${fmtBytes(downloaded)} / ${totalStr} (${pct}) — ${fmtSpeed(speed)}`);
        lastLogTime = now;
        lastLogBytes = downloaded;
      }
    });

    res.data.on('end', () => {
      if (stallTimer) clearTimeout(stallTimer);
      const elapsed = (Date.now() - startTime) / 1000;
      const avg = elapsed > 0 ? downloaded / elapsed : 0;
      console.log(`[Annas] ✓ Terminé — ${fmtBytes(downloaded)} en ${elapsed.toFixed(1)}s (moy. ${fmtSpeed(avg)})`);
      resolve({ buffer: Buffer.concat(chunks), filename });
    });

    res.data.on('error', err => {
      if (stallTimer) clearTimeout(stallTimer);
      reject(err);
    });
  });
}

/**
 * Determine if a ZIP buffer is an EPUB or CBZ.
 * EPUB: first entry in the ZIP is "mimetype" (containing "application/epub+zip").
 * CBZ:  first entry is an image file (jpg, png, gif, webp…).
 * Returns 'epub' or 'cbz'.
 */
function detectZipFormat(buffer) {
  try {
    if (buffer.length < 30) return 'epub';

    // Iterate through ZIP local file headers (PK\x03\x04 = 0x04034b50)
    // to find the first meaningful entry (skipping directory entries).
    // This handles CBZ files that have a root folder as their first entry.
    let offset = 0;
    const MAX_ENTRIES = 20; // examine at most 20 entries

    for (let i = 0; i < MAX_ENTRIES; i++) {
      if (offset + 30 > buffer.length) break;
      // Check local file header signature
      if (buffer.readUInt32LE(offset) !== 0x04034b50) break;

      const fnLen         = buffer.readUInt16LE(offset + 26);
      const extraLen      = buffer.readUInt16LE(offset + 28);
      const compressedSz  = buffer.readUInt32LE(offset + 18);

      if (offset + 30 + fnLen > buffer.length) break;
      const entryName = buffer.slice(offset + 30, offset + 30 + fnLen).toString('utf8');

      // EPUB: first (non-dir) entry must be exactly "mimetype"
      if (entryName === 'mimetype') {
        const contentStart = offset + 30 + fnLen + extraLen;
        const mimeSnippet  = buffer.slice(contentStart, contentStart + 30).toString('utf8');
        return mimeSnippet.includes('epub') ? 'epub' : 'cbz';
      }

      // Skip directory entries (name ends with /)
      if (!entryName.endsWith('/')) {
        // Non-directory, non-mimetype entry → check if it's an image
        if (/\.(jpe?g|png|gif|webp|bmp|tiff?)$/i.test(entryName)) return 'cbz';
        // First real file is not an image and not mimetype → assume epub
        break;
      }

      // Advance to next entry
      const dataStart = offset + 30 + fnLen + extraLen;
      offset = dataStart + compressedSz;
    }

    return 'epub'; // default
  } catch {
    return 'epub';
  }
}

const KNOWN_EBOOK_EXTS = new Set(['epub', 'mobi', 'pdf', 'cbz', 'cbr', 'azw3', 'fb2', 'djvu']);

/**
 * Try to extract a direct file URL embedded in an HTML page.
 * Returns the first URL pointing to a downloadable file, or null.
 */
function extractFileUrlFromHtml(html) {
  const patterns = [
    // explicit file extensions in href
    /href="(https?:\/\/(?!.*annas-archive)[^"]+\.(?:epub|pdf|mobi|azw3|fb2|djvu)[^"]*)"/i,
    // window.location / window.location.href JS redirect
    /window\.location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)["']/,
    // meta refresh
    /content="\d+;\s*url=(https?:\/\/[^"']+)["']/i,
    // CDN-like hostnames — require a known ebook extension to avoid CSS/JS CDNs
    /"(https?:\/\/(?:cdn\d*\.|storage\d*\.|dl\.|download\.)[^"']+\.(?:epub|mobi|pdf|cbz|cbr|azw3|fb2|djvu))(?:[?#][^"']*)?"/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1];
  }
  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Search Anna's Archive and return enriched results.
 */
export async function searchOnAnnasArchive(query) {
  const config = await getConfig();
  if (!config.enabled) throw new Error('Connecteur Anna\'s Archive désactivé');

  const baseUrl = await getWorkingUrl((config.url || FALLBACK_URLS[0]).replace(/\/$/, ''));

  const params = { q: query };
  if (config.lang) params.lang = config.lang;

  const res = await axios.get(`${baseUrl}/search`, {
    params,
    headers: HEADERS,
    timeout: 20000,
  });

  const results = parseResults(res.data, baseUrl);
  return { results, baseUrl };
}

/**
 * Download a book from Anna's Archive by MD5 hash for a given request.
 * Uses FlareSolverr to bypass DDoS-Guard, then attempts direct file download.
 */
export async function downloadFromAnnas(md5, requestId, hintFormat = null) {
  try {
    const config = await getConfig();
    if (!config.enabled) throw new Error('Connecteur Anna\'s Archive désactivé');

    const baseUrl = await getWorkingUrl((config.url || FALLBACK_URLS[0]).replace(/\/$/, ''));
    const md5PageUrl = `${baseUrl}/md5/${md5}`;

    console.log(`[Annas] Téléchargement MD5=${md5} pour demande ${requestId}`);

    let fileBuffer = null;
    let filename = null;

    {
      // ── Fetch MD5 page : direct d'abord, FlareSolverr en fallback ────────────
      let html = '';
      try {
        const direct = await axios.get(md5PageUrl, {
          headers: HEADERS,
          timeout: 15000,
          validateStatus: s => s < 500,
        });
        const body = typeof direct.data === 'string' ? direct.data : '';
        if (body && !body.includes('DDoS-Guard') && !body.includes('ddos-guard')) {
          html = body;
          console.log(`[Annas] Page MD5 récupérée directement`);
        } else {
          throw new Error('DDoS-Guard détecté sur accès direct');
        }
      } catch (directErr) {
        console.log(`[Annas] Accès direct échoué (${directErr.message}), essai FlareSolverr…`);
        const result = await cfFetch(md5PageUrl);
        html = result.html;
      }

      const downloadLinks = parseDownloadLinks(html, baseUrl);

      console.log(`[Annas] ${downloadLinks.length} lien(s) trouvé(s):`, downloadLinks.map(l => l.type));

      if (downloadLinks.length === 0) {
        throw new Error('Aucun lien de téléchargement trouvé sur la page MD5');
      }

      // Garder 3 liens slow max + liens ads (libgen ads.php) + liens partner directs
      const slowLinks    = downloadLinks.filter(l => l.type === 'slow').slice(0, 3);
      let adsLinks       = downloadLinks.filter(l => l.type === 'ads');
      const partnerLinks = downloadLinks.filter(l => l.type === 'partner');

      // Si aucun lien ads trouvé (liens partenaires chargés en JS, invisibles en accès direct),
      // construire directement les URLs partenaires à partir du MD5
      if (adsLinks.length === 0) {
        adsLinks = [
          { type: 'ads', url: `https://libgen.li/ads.php?md5=${md5}` },
          { type: 'ads', url: `https://libgen.rs/ads.php?md5=${md5}` },
        ];
        console.log(`[Annas] Aucun lien ads dans le HTML — construction URLs libgen/libgen.rs directes`);
      }


      const linksToTry = [...adsLinks, ...slowLinks, ...partnerLinks];

      console.log(`[Annas] Liens à essayer: ${linksToTry.map(l => l.type).join(', ')}`);

      // ── Try each link until one succeeds ────────────────────────────────────
      for (const link of linksToTry) {
        if (fileBuffer) break;
        console.log(`[Annas] Essai ${link.type}: ${link.url}`);

        try {
          if (link.type === 'slow') {
            // ── slow_download : FlareSolverr pour bypass DDoS-Guard ───────────
            const { html: dlHtml, finalUrl } = await cfFetch(link.url, 30000);

            console.log(`[Annas] slow_download finalUrl: ${finalUrl}`);

            // Détecter le rate-limit IP d'Anna's Archive
            if ((dlHtml || '').includes('Too many downloads')) {
              console.warn(`[Annas] Rate-limit IP détecté — téléchargement reporté au prochain passage`);
              break;
            }

            console.log(`[Annas] slow_download HTML (200 premiers chars): ${(dlHtml || '').slice(0, 200)}`);

            // 1. FlareSolverr a suivi une redirection hors de la page slow_download
            const redirectedAway = finalUrl && finalUrl !== link.url && !finalUrl.includes('/slow_download/');
            if (redirectedAway) {
              console.log(`[Annas] Redirect → ${finalUrl}`);
              try {
                const { buffer, filename: fn } = await directDownload(finalUrl, HEADERS['User-Agent']);
                fileBuffer = buffer;
                if (fn) filename = fn;
                console.log(`[Annas] ✓ Téléchargé via slow+redirect (${fileBuffer.length} octets)`);
              } catch (e) {
                console.warn(`[Annas] Redirect échoué: ${e.message}`);
              }
            }

            // 2. Chercher un lien de fichier dans le HTML rendu
            if (!fileBuffer) {
              const fileUrl = extractFileUrlFromHtml(dlHtml);
              if (fileUrl) {
                console.log(`[Annas] URL extraite du HTML: ${fileUrl}`);
                try {
                  const { buffer, filename: fn } = await directDownload(fileUrl, HEADERS['User-Agent']);
                  fileBuffer = buffer;
                  if (fn) filename = fn;
                  console.log(`[Annas] ✓ Téléchargé via slow+parse (${fileBuffer.length} octets)`);
                } catch (e) {
                  console.warn(`[Annas] Parse URL échoué: ${e.message}`);
                  // 429 CDN → essayer le prochain lien slow (CDN différent)
                  if (e.message?.includes('429')) {
                    console.log(`[Annas] Rate-limit CDN (429) — essai du lien suivant`);
                    continue;
                  }
                }
              } else {
                console.log(`[Annas] Aucune URL de fichier trouvée dans le HTML`);
              }
            }

          } else if (link.type === 'ads') {
            // ── libgen ads.php : parse HTML → get.php → fichier ──────────────
            const { buffer, filename: fn } = await downloadFromAdsPage(link.url);
            fileBuffer = buffer;
            if (fn) filename = fn;
            console.log(`[Annas] ✓ Téléchargé via ads page (${fileBuffer.length} octets)`);
          } else {
            // ── partner link direct ───────────────────────────────────────────
            const { buffer, filename: fn } = await directDownload(link.url, HEADERS['User-Agent']);
            fileBuffer = buffer;
            if (fn) filename = fn;
            console.log(`[Annas] ✓ Téléchargé via partner (${fileBuffer.length} octets)`);
          }
        } catch (err) {
          console.warn(`[Annas] Lien ${link.type} échoué: ${err.message}`);
        }
      }
    }

    if (!fileBuffer) throw new Error('Tous les liens de téléchargement ont échoué');

    // ── Determine filename ────────────────────────────────────────────────────
    const request = await BookRequest.findById(requestId);
    if (!request) throw new Error(`Demande ${requestId} introuvable`);
    if (request.status === 'completed') {
      console.log(`[Annas] Demande ${requestId} déjà complétée`);
      return;
    }

    // ── Déterminer l'extension finale ────────────────────────────────────────
    // Priorité pour l'extension (du plus fiable au moins fiable) :
    //   1. Extension depuis l'URL de téléchargement (ex: .mobi dans le chemin CDN)
    //   2. Extension depuis Content-Disposition
    //   3. hintFormat depuis la fiche Anna's Archive
    //   4. Magic bytes pour PDF et ZIP (epub/cbz)
    //   5. 'epub' par défaut
    // Le nom de base = toujours le titre de la demande (propre et court)
    {
      const magic = fileBuffer.slice(0, 4).toString('hex');
      const knownExts = ['epub', 'mobi', 'pdf', 'cbz', 'cbr', 'azw3', 'fb2', 'djvu'];

      // Extension depuis le filename récupéré (URL ou Content-Disposition)
      const serverExt = filename
        ? path.extname(filename).toLowerCase().replace('.', '')
        : null;

      let ext;
      if (serverExt && knownExts.includes(serverExt)) {
        // Le serveur / l'URL nous dit le bon format
        ext = serverExt;
        // Pour ZIP déclaré epub/cbz, vérifier le contenu réel
        if ((ext === 'epub' || ext === 'cbz') && magic.startsWith('504b')) {
          ext = detectZipFormat(fileBuffer);
        }
      } else if (hintFormat) {
        const normalizedHint = hintFormat.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (KNOWN_EBOOK_EXTS.has(normalizedHint)) {
          ext = normalizedHint;
          if ((ext === 'epub' || ext === 'cbz') && magic.startsWith('504b')) {
            ext = detectZipFormat(fileBuffer);
          }
        } else {
          // hintFormat n'est pas un format ebook connu (ex: "English [en]") → magic bytes
          if (magic.startsWith('25504446')) ext = 'pdf';
          else if (magic.startsWith('504b')) ext = detectZipFormat(fileBuffer);
          else ext = 'epub';
        }
      } else if (magic.startsWith('25504446')) {
        ext = 'pdf';
      } else if (magic.startsWith('504b')) {
        ext = detectZipFormat(fileBuffer);
      } else {
        ext = 'epub';
      }

      // Toujours utiliser le titre de la demande comme base (pas le nom verbeux du CDN)
      const baseName = request.title.replace(/[<>:"/\\|?*]/g, '').trim();
      const prevFilename = filename || '(aucun)';
      filename = `${baseName}.${ext}`;
      console.log(`[Annas] Fichier: "${path.basename(prevFilename)}" → "${filename}" (serverExt: ${serverExt || '-'}, hint: ${hintFormat || '-'}, magic: ${magic.slice(0, 8)})`);
    }

    filename = filename.replace(/[<>:"/\\|?*]/g, '').trim();
    if (!filename) filename = `${md5}.epub`;

    // ── Save file ─────────────────────────────────────────────────────────────
    const uploadsDir = path.join(__dirname, '../../uploads/books');
    fs.mkdirSync(uploadsDir, { recursive: true });
    const destPath = path.join(uploadsDir, filename);
    fs.writeFileSync(destPath, fileBuffer);
    console.log(`[Annas] ✓ Fichier sauvegardé: ${filename}`);

    // ── Complete request ──────────────────────────────────────────────────────
    request.status = 'completed';
    request.filePath = `books/${filename}`;
    request.completedAt = new Date();
    if (!Array.isArray(request.statusHistory)) request.statusHistory = [];
    request.statusHistory.push({
      status: 'completed',
      changedBy: 'annas-archive',
      note: 'Téléchargé automatiquement via Anna\'s Archive',
    });
    await request.save();

    // ── Post-completion hooks (non-blocking) ─────────────────────────────────
    runPostCompletionHooks(request, request.user).catch(e => console.error('[Calibre]', e.message));

    // ── Notify user ───────────────────────────────────────────────────────────
    const user = await User.findById(request.user);
    if (!user) return;

    try {
      if (user.emailVerified && user.email) await sendBookCompletedEmail(user, request);
    } catch (e) { console.error('[Annas] Erreur email:', e.message); }

    try {
      await sendPushToUser(user._id, {
        title: '📖 Livre disponible !',
        body: `"${request.title}" a été téléchargé automatiquement.`,
        url: '/dashboard',
      });
    } catch (e) { console.error('[Annas] Erreur push:', e.message); }

    try {
      await Notification.create({
        user: user._id,
        type: 'request_completed',
        title: request.title,
        author: request.author,
        message: `"${request.title}" a été téléchargé automatiquement via Anna's Archive.`,
      });
    } catch (e) { console.error('[Annas] Erreur notification:', e.message); }

    return { filename };

  } catch (err) {
    console.error('[Annas] Erreur téléchargement:', err.message);
    throw err;
  }
}

/**
 * GET / PUT config for Anna's Archive connector.
 */
export async function getAnnasArchiveConfig() {
  const doc = await ConnectorSettings.findOne({ service: 'annasarchive' }).lean();
  return doc || { service: 'annasarchive', enabled: false, url: FALLBACK_URLS[0], lang: '' };
}

export async function saveAnnasArchiveConfig({ enabled, url, lang }) {
  const doc = await ConnectorSettings.findOneAndUpdate(
    { service: 'annasarchive' },
    { enabled: !!enabled, url: url?.trim() || FALLBACK_URLS[0], lang: lang || '' },
    { upsert: true, new: true, runValidators: true }
  );
  return doc;
}

export async function pingAnnasArchive() {
  const config = await getAnnasArchiveConfig();
  const baseUrl = config.url || FALLBACK_URLS[0];
  const response = await axios.get(baseUrl, {
    timeout: 5000,
    headers: { 'User-Agent': 'Mozilla/5.0' },
    validateStatus: s => s < 500,
  });
  return response.status < 500;
}
