import express from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import ConnectorSettings from '../models/ConnectorSettings.js';
import BookRequest from '../models/BookRequest.js';
import DownloadLog from '../models/DownloadLog.js';
import { testConnectionValentine, searchOnValentine, downloadFromValentineById, getValentineQuota } from '../services/valentineService.js';
import { invalidateAdminEmailPrefsCache } from '../controllers/bookRequestController.js';
import { getNextScanTime, restartCronInterval } from '../services/valentineCron.js';
import { searchOnAnnasArchive, getAnnasArchiveConfig, saveAnnasArchiveConfig, downloadFromAnnas, pingAnnasArchive } from '../services/annasArchiveService.js';
import { encrypt, decrypt } from '../services/cryptoService.js';

const router = express.Router();

// ── GET /api/connectors/valentine/next-scan ───────────────────────────────────
router.get('/valentine/next-scan', requireAuth, requireAdmin, (req, res) => {
  res.json({ nextScanAt: getNextScanTime() });
});

// ── GET /api/connectors/valentine ─────────────────────────────────────────────
router.get('/valentine', requireAuth, requireAdmin, async (req, res) => {
  try {
    let doc = await ConnectorSettings.findOne({ service: 'valentine' }).lean();
    if (!doc) doc = { service: 'valentine', enabled: false, url: 'https://valentine.wtf', username: '', password: '', cronInterval: 6, valentineFallbackToAdmin: false };
    res.json({
      ...doc,
      password: doc.password ? '••••••••' : '',
      _hasPassword: !!doc.password,
      cronInterval: doc.cronInterval || 6,
      valentineFallbackToAdmin: doc.valentineFallbackToAdmin ?? false,
    });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── PUT /api/connectors/valentine ─────────────────────────────────────────────
router.put('/valentine', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { enabled, url, username, password, _hasPassword, cronInterval, valentineFallbackToAdmin } = req.body;

    const update = {
      enabled: !!enabled,
      url: url?.trim() || 'https://valentine.wtf',
      username: username?.trim() || '',
      cronInterval: Number(cronInterval) || 6,
      valentineFallbackToAdmin: !!valentineFallbackToAdmin,
    };

    if (password && password !== '••••••••') {
      update.password = encrypt(password);
    }
    if (!password && !_hasPassword) {
      update.password = '';
    }

    const doc = await ConnectorSettings.findOneAndUpdate(
      { service: 'valentine' },
      update,
      { upsert: true, new: true, runValidators: true }
    );

    restartCronInterval(doc.cronInterval || 6);

    res.json({
      ...doc.toObject(),
      password: doc.password ? '••••••••' : '',
      _hasPassword: !!doc.password,
      cronInterval: doc.cronInterval || 6,
    });
  } catch {
    res.status(500).json({ error: 'Erreur lors de la sauvegarde' });
  }
});

// ── POST /api/connectors/valentine/test ───────────────────────────────────────
router.post('/valentine/test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Identifiant et mot de passe requis pour le test' });
    }
    let realPassword = password;
    if (password === '••••••••') {
      const doc = await ConnectorSettings.findOne({ service: 'valentine' }).lean();
      const raw = doc?.password || '';
      realPassword = decrypt(raw) ?? raw; // fallback si ancien mot de passe en clair
    }
    if (!realPassword) {
      return res.status(400).json({ error: 'Mot de passe non renseigné' });
    }
    await testConnectionValentine(username.trim(), realPassword);
    res.json({ success: true, message: 'Connexion réussie — valentine.wtf' });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Connexion impossible' });
  }
});

// ── GET /api/connectors/valentine/quota ───────────────────────────────────────
router.get('/valentine/quota', requireAuth, requireAdmin, async (req, res) => {
  try {
    const doc = await ConnectorSettings.findOne({ service: 'valentine' }).lean();
    if (!doc?.enabled || !doc?.username || !doc?.password) {
      return res.status(400).json({ error: 'Valentine non configuré ou désactivé' });
    }
    const raw = doc.password || '';
    const password = decrypt(raw) ?? raw;
    const quota = await getValentineQuota(doc.username, password);
    res.json(quota);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erreur lors de la récupération du quota' });
  }
});

// ── GET /api/connectors/valentine/search?q=... ────────────────────────────────
router.get('/valentine/search', requireAuth, requireAdmin, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Paramètre q requis' });
  try {
    const results = await searchOnValentine(q);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/connectors/valentine/download-request ──────────────────────────
router.post('/valentine/download-request', requireAuth, requireAdmin, async (req, res) => {
  const { requestId, ebookId } = req.body;
  if (!requestId || !ebookId) return res.status(400).json({ error: 'requestId et ebookId requis' });
  try {
    const result = await downloadFromValentineById(requestId, ebookId);
    const br = await BookRequest.findById(requestId).lean();
    await DownloadLog.create({ bookRequestId: requestId, title: br?.title || '', author: br?.author || '', username: br?.username || '', connector: 'valentine', success: true, triggeredBy: 'admin' });
    res.json({ success: true, ...result });
  } catch (err) {
    const br = await BookRequest.findById(requestId).lean().catch(() => null);
    await DownloadLog.create({ bookRequestId: requestId, title: br?.title || '', author: br?.author || '', username: br?.username || '', connector: 'valentine', success: false, error: err.message.slice(0, 500), triggeredBy: 'admin' }).catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/connectors/annasarchive ─────────────────────────────────────────
router.get('/annasarchive', requireAuth, requireAdmin, async (req, res) => {
  try {
    const doc = await getAnnasArchiveConfig();
    res.json({ enabled: doc.enabled, url: doc.url, lang: doc.lang || '' });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── PUT /api/connectors/annasarchive ─────────────────────────────────────────
router.put('/annasarchive', requireAuth, requireAdmin, async (req, res) => {
  try {
    const doc = await saveAnnasArchiveConfig(req.body);
    res.json({ enabled: doc.enabled, url: doc.url });
  } catch {
    res.status(500).json({ error: 'Erreur lors de la sauvegarde' });
  }
});

// ── GET /api/connectors/annasarchive/ping ────────────────────────────────────
router.get('/annasarchive/ping', requireAuth, requireAdmin, async (req, res) => {
  try {
    await pingAnnasArchive();
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

// ── GET /api/connectors/annasarchive/search?q=... ─────────────────────────────
router.get('/annasarchive/search', requireAuth, requireAdmin, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Paramètre q requis' });
  try {
    const { results, baseUrl } = await searchOnAnnasArchive(q);
    res.json({ results, baseUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/connectors/annasarchive/download ────────────────────────────────
router.post('/annasarchive/download', requireAuth, requireAdmin, async (req, res) => {
  const { md5, requestId, format } = req.body;
  if (!md5 || !requestId) return res.status(400).json({ error: 'md5 et requestId requis' });
  try {
    const result = await downloadFromAnnas(md5, requestId, format || null);
    const br = await BookRequest.findById(requestId).lean();
    await DownloadLog.create({ bookRequestId: requestId, title: br?.title || '', author: br?.author || '', username: br?.username || '', connector: 'annasarchive', success: true, triggeredBy: 'admin' });
    res.json({ success: true, ...result });
  } catch (err) {
    const br = await BookRequest.findById(requestId).lean().catch(() => null);
    await DownloadLog.create({ bookRequestId: requestId, title: br?.title || '', author: br?.author || '', username: br?.username || '', connector: 'annasarchive', success: false, error: err.message.slice(0, 500), triggeredBy: 'admin' }).catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/connectors/email ─────────────────────────────────────────────────
router.get('/email', requireAuth, requireAdmin, async (req, res) => {
  try {
    let doc = await ConnectorSettings.findOne({ service: 'email' }).lean();
    if (!doc) doc = {};
    res.json({
      enabled:            doc.emailEnabled         ?? true,
      notifyOnNewRequest: doc.notifyOnNewRequest    ?? true,
      notifyOnComplete:   doc.notifyOnComplete      ?? true,
      notifyOnCancel:     doc.notifyOnCancel        ?? true,
      notifyOnComment:    doc.notifyOnComment       ?? true,
      notifyOnReport:     doc.notifyOnReport        ?? true,
      notifyOnNewUser:       doc.notifyOnNewUser        ?? true,
      notifyOnDownloadFailed: doc.notifyOnDownloadFailed ?? true,
    });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── PUT /api/connectors/email ─────────────────────────────────────────────────
router.put('/email', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { enabled, notifyOnNewRequest, notifyOnComplete, notifyOnCancel, notifyOnComment, notifyOnReport, notifyOnNewUser, notifyOnDownloadFailed } = req.body;
    await ConnectorSettings.findOneAndUpdate(
      { service: 'email' },
      {
        emailEnabled:          !!enabled,
        notifyOnNewRequest:    !!notifyOnNewRequest,
        notifyOnComplete:      !!notifyOnComplete,
        notifyOnCancel:        !!notifyOnCancel,
        notifyOnComment:       !!notifyOnComment,
        notifyOnReport:        !!notifyOnReport,
        notifyOnNewUser:       !!notifyOnNewUser,
        notifyOnDownloadFailed: notifyOnDownloadFailed !== false,
      },
      { upsert: true, new: true }
    );
    invalidateAdminEmailPrefsCache();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Erreur lors de la sauvegarde' });
  }
});

export default router;