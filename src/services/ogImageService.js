import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Le conteneur de prod ne copie que frontend/build (pas frontend/public), voir
// Dockerfile — Vite recopie tel quel le contenu de public/ dans build/ au
// moment du build, donc le logo s'y retrouve aussi à ce chemin.
const LOGO_PATH = path.join(__dirname, '../../frontend/build/img/logo.png');
const logoBase64 = fs.existsSync(LOGO_PATH)
  ? fs.readFileSync(LOGO_PATH).toString('base64')
  : null;

function escapeXml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Tronque un nom trop long plutôt que de laisser le texte déborder du cadre
// (pas de retour à la ligne automatique en SVG texte brut).
function truncate(str, max) {
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

/**
 * Génère l'image d'aperçu (Open Graph) pour une bibliothèque partagée — carte
 * 1200x630 au format standard attendu par Discord/Twitter/iMessage. Rendue en
 * SVG puis rasterisée en PNG via sharp (le SVG brut n'est pas fiablement
 * supporté comme og:image par tous ces clients).
 */
export async function renderLibraryOgImage({ username, bookCount, readCount }) {
  const safeUsername = escapeXml(truncate(username || '', 28));
  const stats = `${bookCount} livre${bookCount > 1 ? 's' : ''} · ${readCount} lu${readCount > 1 ? 's' : ''}`;

  const svg = `
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#121212"/>
      <stop offset="100%" stop-color="#1e1b3a"/>
    </linearGradient>
    <radialGradient id="glow" cx="85%" cy="15%" r="60%">
      <stop offset="0%" stop-color="#6366f1" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#6366f1" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>

  ${logoBase64 ? `<image href="data:image/png;base64,${logoBase64}" x="80" y="80" width="88" height="88" />` : ''}

  <text x="80" y="260" font-family="DejaVu Sans, Arial, sans-serif" font-size="56" font-weight="700" fill="#ffffff">
    Bibliothèque de ${safeUsername}
  </text>
  <text x="80" y="320" font-family="DejaVu Sans, Arial, sans-serif" font-size="30" fill="#94a3b8">
    ${escapeXml(stats)}
  </text>

  <rect x="78" y="520" width="56" height="4" rx="2" fill="#6366f1"/>
  <text x="80" y="570" font-family="DejaVu Sans, Arial, sans-serif" font-size="26" font-weight="700" fill="#6366f1">
    EbookRequest
  </text>
</svg>`.trim();

  return sharp(Buffer.from(svg)).png().toBuffer();
}
