import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import User from '../models/User.js';
import BookRequest from '../models/BookRequest.js';
import OpdsLog from '../models/OpdsLog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

async function findUserByToken(token) {
  return User.findOne({ opdsToken: token }).select('_id username');
}

// Extrait le token OPDS depuis :
//   1. Le paramètre d'URL (:token)
//   2. Le mot de passe HTTP Basic Auth (compatible Panels, Calibre, KOReader…)
function resolveToken(req) {
  // 1. Token dans l'URL
  if (req.params.token) return req.params.token;

  // 2. Basic Auth — Authorization: Basic base64(username:password)
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Basic ')) {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
    const colonIdx = decoded.indexOf(':');
    if (colonIdx !== -1) {
      return decoded.slice(colonIdx + 1); // le mot de passe = token OPDS
    }
  }
  return null;
}

// Demande les credentials si aucun token trouvé
function requireToken(req, res, next) {
  const token = resolveToken(req);
  if (!token) {
    res.set('WWW-Authenticate', 'Basic realm="EbookRequest OPDS"');
    return res.status(401).send('Authentification requise');
  }
  req.opdsToken = token;
  next();
}

const escapeXml = (str = '') => String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

async function sendCatalog(req, res, token) {
  const user = await findUserByToken(token);
  if (!user) {
    res.set('WWW-Authenticate', 'Basic realm="EbookRequest OPDS"');
    return res.status(401).send('Token invalide');
  }

  const ua = req.headers['user-agent'] || '';
  await OpdsLog.create({
    user: user._id,
    action: 'catalog',
    ip: req.ip,
    userAgent: ua,
    client: OpdsLog.parseClient(ua),
  });

  const books = await BookRequest.find({
    user: user._id,
    status: 'completed',
    $or: [
      { downloadLink: { $exists: true, $ne: '' } },
      { filePath: { $exists: true, $ne: '' } }
    ]
  }).sort({ completedAt: -1 });

  const baseUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`;
  // Les liens de téléchargement utilisent toujours le token dans l'URL
  // (le client garde les credentials en mémoire pour les catalog views,
  //  mais les redirections download doivent être auto-portantes)
  const feedSelf = `${baseUrl}/api/opds/${token}`;
  const updated = new Date().toISOString();

  const entries = books.map(book => {
    const bookUpdated = (book.completedAt || book.updatedAt || new Date()).toISOString();
    const downloadHref = `${baseUrl}/api/opds/${token}/download/${book._id}`;

    const fileSource = book.filePath || book.downloadLink || '';
    const ext = fileSource.split('.').pop().toLowerCase().split('?')[0];
    const mimeMap = {
      epub: 'application/epub+zip',
      pdf: 'application/pdf',
      mobi: 'application/x-mobipocket-ebook',
      azw3: 'application/x-mobi8-ebook',
      cbz: 'application/x-cbz'
    };
    const mime = mimeMap[ext] || 'application/octet-stream';

    return `
  <entry>
    <title>${escapeXml(book.title)}</title>
    <id>urn:ebookrequest:book:${book._id}</id>
    <updated>${bookUpdated}</updated>
    <author><name>${escapeXml(book.author)}</name></author>
    ${book.description ? `<summary>${escapeXml(book.description.substring(0, 500))}</summary>` : ''}
    ${book.thumbnail ? `
    <link rel="http://opds-spec.org/image" type="image/jpeg" href="${escapeXml(book.thumbnail)}"/>
    <link rel="http://opds-spec.org/image/thumbnail" type="image/jpeg" href="${escapeXml(book.thumbnail)}"/>` : ''}
    <link rel="http://opds-spec.org/acquisition" type="${mime}" href="${escapeXml(downloadHref)}"/>
  </entry>`;
  }).join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:opds="http://opds-spec.org/2010/catalog"
      xmlns:dc="http://purl.org/dc/terms/">
  <id>urn:ebookrequest:opds:${user._id}</id>
  <title>Mes livres — EbookRequest</title>
  <updated>${updated}</updated>
  <author><name>EbookRequest</name></author>
  <link rel="self" type="application/atom+xml;profile=opds-catalog;kind=acquisition" href="${escapeXml(feedSelf)}"/>
  <link rel="start" type="application/atom+xml;profile=opds-catalog;kind=acquisition" href="${escapeXml(feedSelf)}"/>
  ${entries}
</feed>`;

  res.set('Content-Type', 'application/atom+xml; charset=utf-8');
  res.send(xml);
}

// ── Routes ───────────────────────────────────────────────────────────────────

// Mode Basic Auth : GET /api/opds/
// → Hôte: https://ebook.zlimteck.fr/api/opds  Port: 443
// → Utilisateur: (n'importe lequel)  Mot de passe: token OPDS
router.get('/', requireToken, async (req, res) => {
  try {
    await sendCatalog(req, res, req.opdsToken);
  } catch (err) {
    console.error('Erreur OPDS catalog (basic auth):', err);
    res.status(500).send('Erreur serveur');
  }
});

// Mode token dans l'URL : GET /api/opds/:token
// → URL complète copiable depuis les paramètres utilisateur
router.get('/:token', async (req, res) => {
  try {
    await sendCatalog(req, res, req.params.token);
  } catch (err) {
    console.error('Erreur OPDS catalog (token url):', err);
    res.status(500).send('Erreur serveur');
  }
});

// Téléchargement — fonctionne dans les deux modes (token toujours dans l'URL)
router.get('/:token/download/:requestId', async (req, res) => {
  try {
    const user = await findUserByToken(req.params.token);
    if (!user) return res.status(401).send('Token invalide');

    const book = await BookRequest.findOne({
      _id: req.params.requestId,
      user: user._id,
      status: 'completed'
    });
    if (!book || (!book.downloadLink && !book.filePath)) return res.status(404).send('Livre non trouvé');

    const ua = req.headers['user-agent'] || '';
    await OpdsLog.create({
      user: user._id,
      action: 'download',
      bookRequest: book._id,
      bookTitle: book.title,
      ip: req.ip,
      userAgent: ua,
      client: OpdsLog.parseClient(ua),
    });

    if (book.filePath) {
      // Fichier uploadé — on le sert directement
      const filePath = path.join(__dirname, '../../uploads', book.filePath);
      if (!fs.existsSync(filePath)) return res.status(404).send('Fichier introuvable sur le serveur');
      const fileName = path.basename(filePath);
      return res.download(filePath, fileName);
    }

    res.redirect(book.downloadLink);
  } catch (err) {
    console.error('Erreur OPDS download:', err);
    res.status(500).send('Erreur serveur');
  }
});

export default router;