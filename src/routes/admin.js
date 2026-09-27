import express from 'express';
import crypto from 'crypto';
import { getAdminStats, getServicesHealth } from '../controllers/adminController.js';
import DownloadLog from '../models/DownloadLog.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { getLogBuffer, subscribeToLogs, unsubscribeFromLogs } from '../services/logBuffer.js';
import BookRequest from '../models/BookRequest.js';
import AdminLog from '../models/AdminLog.js';
import upload from '../middleware/upload.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Map des tokens SSE éphémères : token → expiresAt
const sseTokens = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [t, exp] of sseTokens) {
    if (exp < now) sseTokens.delete(t);
  }
}, 60000);

// ── Route SSE (doit être AVANT requireAuth car EventSource ne peut pas envoyer
//    de header Authorization → token éphémère via POST /sse-token)
router.get('/logs/system/stream', (req, res) => {
  const token = req.query.token;
  if (!token) {
    return res.status(401).json({ error: 'Token manquant.' });
  }
  const expiresAt = sseTokens.get(token);
  if (!expiresAt || expiresAt < Date.now()) {
    sseTokens.delete(token);
    return res.status(401).json({ error: 'Token SSE invalide ou expiré.' });
  }
  sseTokens.delete(token); // usage unique

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // désactiver le buffering nginx
  res.flushHeaders();

  // Keepalive toutes les 25 s pour éviter les timeouts proxy
  const keepalive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 25000);

  const onLine = (line) => {
    res.write(`data: ${JSON.stringify(line)}\n\n`);
  };

  subscribeToLogs(onLine);

  req.on('close', () => {
    clearInterval(keepalive);
    unsubscribeFromLogs(onLine);
  });
});

// ── Toutes les routes suivantes requièrent auth + rôle admin ──
router.use(requireAuth);
router.use(requireAdmin);

// Génère un token SSE éphémère (60s, usage unique) pour l'endpoint stream
router.post('/logs/system/sse-token', (req, res) => {
  const token = crypto.randomUUID();
  sseTokens.set(token, Date.now() + 60000);
  res.json({ sseToken: token });
});

router.get('/stats', getAdminStats);
router.get('/health', getServicesHealth);

// Vide le cache mémoire de recherche (Google Books/Hardcover/Open Library, TTL 5 min) —
// utile après un changement de config pour forcer un résultat frais sans attendre le TTL.
router.post('/search-cache/clear', async (req, res) => {
  try {
    const { clearBooksSearchCache } = await import('./googleBooks.js');
    const cleared = clearBooksSearchCache();
    res.json({ success: true, cleared });
  } catch {
    res.status(500).json({ error: 'Erreur lors du vidage du cache' });
  }
});

// Lance immédiatement le check de rupture provider (sans attendre le cron), en forçant
// l'envoi même si une alerte a déjà été envoyée dans les dernières 24h — pour tester.
router.post('/provider-health/check-now', async (req, res) => {
  try {
    const { runProviderHealthCron } = await import('../services/providerHealthCron.js');
    await runProviderHealthCron(true);
    res.json({ success: true, message: 'Vérification effectuée — voir les logs serveur et vos notifications.' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erreur lors de la vérification' });
  }
});

router.get('/download-logs', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const { connector, success, searchMode } = req.query;

    const filter = {};
    if (connector) filter.connector = connector;
    if (success !== undefined) filter.success = success === 'true';
    if (searchMode) filter.searchMode = searchMode;

    const [logs, total] = await Promise.all([
      DownloadLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      DownloadLog.countDocuments(filter),
    ]);

    res.json({ logs, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Stats d'un utilisateur spécifique pour le modal admin
router.get('/user-stats/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [total, pending, completed, recentCount] = await Promise.all([
      BookRequest.countDocuments({ user: userId }),
      BookRequest.countDocuments({ user: userId, status: 'pending' }),
      BookRequest.countDocuments({ user: userId, status: 'completed' }),
      BookRequest.countDocuments({ user: userId, createdAt: { $gte: thirtyDaysAgo } }),
    ]);

    res.json({ total, pending, completed, recentCount });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Liste des fichiers dans le dossier uploads/books
router.get('/uploads-list', (req, res) => {
  try {
    const uploadDir = path.join(__dirname, '../../uploads/books');
    if (!fs.existsSync(uploadDir)) {
      return res.json({ success: true, files: [] });
    }
    const files = fs.readdirSync(uploadDir)
      .filter(name => !name.startsWith('.'))
      .map(name => {
        const fullPath = path.join(uploadDir, name);
        const stat = fs.statSync(fullPath);
        return {
          name,
          filePath: `books/${name}`,
          size: stat.size,
          modifiedAt: stat.mtime,
        };
      })
      .sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
    res.json({ success: true, files });
  } catch (err) {
    console.error('Erreur uploads-list:', err);
    res.status(500).json({ success: false, files: [] });
  }
});

// ── Gestionnaire de fichiers (uploads/books) ────────────────────────────────
// Distinct de /uploads-list (déjà utilisé par le sélecteur "fichier existant"
// à la création d'une demande) : renvoie aussi les demandes liées à chaque
// fichier, nécessaire pour l'avertissement avant suppression/renommage. Un
// même fichier physique peut être référencé par plusieurs BookRequest (étagères
// additionnelles multi-utilisateurs) — voir BookRequest.filePath.
const filesUploadDir = path.join(__dirname, '../../uploads/books');

// Empêche toute traversée de répertoire : le nom résolu doit rester strictement
// dans uploads/books, jamais utiliser un chemin fourni par le client tel quel.
function resolveSafeFileName(name) {
  const safe = path.basename(String(name || ''));
  if (!safe || safe !== name) return null;
  const fullPath = path.join(filesUploadDir, safe);
  if (!fullPath.startsWith(filesUploadDir + path.sep)) return null;
  return { safe, fullPath };
}

router.get('/files', async (req, res) => {
  try {
    if (!fs.existsSync(filesUploadDir)) return res.json({ success: true, files: [] });

    const names = fs.readdirSync(filesUploadDir).filter(name => !name.startsWith('.'));
    const relPaths = names.map(name => `books/${name}`);
    const linkedRequests = await BookRequest.find({ filePath: { $in: relPaths } })
      .select('title author username status filePath')
      .lean();
    const linkedByPath = new Map();
    for (const r of linkedRequests) {
      if (!linkedByPath.has(r.filePath)) linkedByPath.set(r.filePath, []);
      linkedByPath.get(r.filePath).push({ _id: r._id, title: r.title, author: r.author, username: r.username, status: r.status });
    }

    const files = names.map(name => {
      const fullPath = path.join(filesUploadDir, name);
      const stat = fs.statSync(fullPath);
      const filePath = `books/${name}`;
      return {
        name,
        filePath,
        size: stat.size,
        modifiedAt: stat.mtime,
        linkedRequests: linkedByPath.get(filePath) || [],
      };
    }).sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));

    res.json({ success: true, files });
  } catch (err) {
    console.error('Erreur GET /files:', err);
    res.status(500).json({ success: false, error: 'Erreur lors de la lecture du dossier.' });
  }
});

router.post('/files', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'Aucun fichier reçu.' });
    res.json({ success: true, file: { name: req.file.filename, filePath: `books/${req.file.filename}` } });
  } catch (err) {
    console.error('Erreur POST /files:', err);
    res.status(500).json({ success: false, error: 'Erreur lors de l\'envoi du fichier.' });
  }
});

router.patch('/files/rename', async (req, res) => {
  try {
    const { name, newName } = req.body;
    const from = resolveSafeFileName(name);
    if (!from || !fs.existsSync(from.fullPath)) {
      return res.status(404).json({ success: false, error: 'Fichier introuvable.' });
    }
    const ext = path.extname(from.safe);
    const requestedNewName = String(newName || '').trim();
    if (!requestedNewName) return res.status(400).json({ success: false, error: 'Nouveau nom requis.' });
    const finalNewName = requestedNewName.toLowerCase().endsWith(ext.toLowerCase()) ? requestedNewName : `${requestedNewName}${ext}`;
    const to = resolveSafeFileName(finalNewName);
    if (!to) return res.status(400).json({ success: false, error: 'Nouveau nom invalide.' });
    if (fs.existsSync(to.fullPath)) return res.status(409).json({ success: false, error: 'Un fichier porte déjà ce nom.' });

    fs.renameSync(from.fullPath, to.fullPath);

    const oldFilePath = `books/${from.safe}`;
    const newFilePath = `books/${to.safe}`;
    const result = await BookRequest.updateMany({ filePath: oldFilePath }, { filePath: newFilePath });

    const adminUser = req.user;
    await AdminLog.create({
      admin: adminUser.id,
      adminUsername: adminUser.username || 'admin',
      action: 'rename_file',
      details: `${oldFilePath} → ${newFilePath} (${result.modifiedCount} demande(s) mise(s) à jour)`,
    }).catch(() => {});

    res.json({ success: true, filePath: newFilePath, updatedRequests: result.modifiedCount });
  } catch (err) {
    console.error('Erreur PATCH /files/rename:', err);
    res.status(500).json({ success: false, error: 'Erreur lors du renommage.' });
  }
});

router.delete('/files', async (req, res) => {
  try {
    const { name, confirm } = req.body;
    const target = resolveSafeFileName(name);
    if (!target || !fs.existsSync(target.fullPath)) {
      return res.status(404).json({ success: false, error: 'Fichier introuvable.' });
    }
    const filePath = `books/${target.safe}`;

    const linked = await BookRequest.find({ filePath }).select('title author username status').lean();
    if (linked.length && !confirm) {
      return res.json({ success: false, requiresConfirmation: true, linkedRequests: linked });
    }

    fs.unlinkSync(target.fullPath);

    if (linked.length) {
      await BookRequest.updateMany(
        { filePath },
        {
          filePath: '',
          status: 'pending',
          autoDownloadFailed: { at: new Date(), reason: 'Fichier supprimé manuellement par un administrateur.' },
        }
      );
    }

    const adminUser = req.user;
    await AdminLog.create({
      admin: adminUser.id,
      adminUsername: adminUser.username || 'admin',
      action: 'delete_file',
      details: `${filePath} (${linked.length} demande(s) repassée(s) en traitement manuel)`,
    }).catch(() => {});

    res.json({ success: true, unlinkedRequests: linked.length });
  } catch (err) {
    console.error('Erreur DELETE /files:', err);
    res.status(500).json({ success: false, error: 'Erreur lors de la suppression.' });
  }
});

// Logs système — buffer complet (protégé par requireAuth + requireAdmin ci-dessus)
// GET /api/admin/logs/system?filter=annas
router.get('/logs/system', (req, res) => {
  let logs = getLogBuffer();
  const { filter } = req.query;
  if (filter) {
    logs = logs.filter(l => l.msg.includes(filter));
  }
  res.json({ logs });
});

export default router;