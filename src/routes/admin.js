import express from 'express';
import jwt from 'jsonwebtoken';
import { getAdminStats, getServicesHealth } from '../controllers/adminController.js';
import DownloadLog from '../models/DownloadLog.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { getLogBuffer, subscribeToLogs, unsubscribeFromLogs } from '../services/logBuffer.js';
import BookRequest from '../models/BookRequest.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// ── Route SSE (doit être AVANT requireAuth car EventSource ne peut pas envoyer
//    de header Authorization → auth manuelle via query param ?token=<jwt>)
router.get('/logs/system/stream', (req, res) => {
  const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
  const token = req.query.token;
  if (!token) {
    return res.status(401).json({ error: 'Token manquant.' });
  }
  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Token invalide.' });
  }
  if (!decoded || decoded.role !== 'admin') {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
  }

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
router.get('/stats', getAdminStats);
router.get('/health', getServicesHealth);

router.get('/download-logs', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const { connector, success } = req.query;

    const filter = {};
    if (connector) filter.connector = connector;
    if (success !== undefined) filter.success = success === 'true';

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