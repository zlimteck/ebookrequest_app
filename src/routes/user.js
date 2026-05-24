import express from 'express';
import crypto from 'crypto';
import { requireAuth } from '../middleware/auth.js';
import { updateUserProfile, verifyEmail, getCurrentUser, changePassword, updateAvatar, getUserStats } from '../controllers/userController.js';
import User from '../models/User.js';
import { encrypt, decrypt } from '../services/cryptoService.js';
import { testCalibreConnection, pushToCalibre } from '../services/calibreService.js';
import BookRequest from '../models/BookRequest.js';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Récupérer le profil de l'utilisateur connecté
router.get('/me', requireAuth, getCurrentUser);

// Stats du profil
router.get('/me/stats', requireAuth, getUserStats);

// Mettre à jour le profil utilisateur
router.put('/profile', requireAuth, updateUserProfile);

// Mettre à jour l'avatar (base64)
router.put('/avatar', requireAuth, updateAvatar);

// Vérifier l'email avec un token
router.get('/verify-email/:token', verifyEmail);

// Changer le mot de passe
router.put('/change-password', requireAuth, changePassword);

// GET /api/users/opds-token — get (or generate) the user's OPDS token
router.get('/opds-token', requireAuth, async (req, res) => {
  try {
    let user = await User.findById(req.user.id).select('opdsToken');
    if (!user.opdsToken) {
      const token = crypto.randomUUID();
      await User.updateOne({ _id: req.user.id }, { $set: { opdsToken: token } });
      user.opdsToken = token;
    }
    const baseUrl = process.env.FRONTEND_URL || '';
    res.json({
      success: true,
      token: user.opdsToken,
      feedUrl: `${baseUrl}/api/opds/${user.opdsToken}`
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/users/opds-token/regenerate — regenerate OPDS token
router.post('/opds-token/regenerate', requireAuth, async (req, res) => {
  try {
    const token = crypto.randomUUID();
    await User.updateOne({ _id: req.user.id }, { $set: { opdsToken: token } });
    const baseUrl = process.env.FRONTEND_URL || '';
    res.json({
      success: true,
      token,
      feedUrl: `${baseUrl}/api/opds/${token}`
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Calibre-Web routes ────────────────────────────────────────────────────────

// GET /api/users/calibre
router.get('/calibre', requireAuth, async (req, res) => {
  try {
    const [user, lastSyncDoc] = await Promise.all([
      User.findById(req.user.id).select('calibreWeb'),
      BookRequest.findOne(
        { user: req.user.id, 'calibrePush.status': 'success' },
        { 'calibrePush.pushedAt': 1 },
        { sort: { 'calibrePush.pushedAt': -1 } }
      ),
    ]);
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    const cfg = user.calibreWeb || {};
    res.json({
      enabled:     cfg.enabled || false,
      url:         cfg.url || '',
      username:    cfg.username || '',
      hasPassword: Boolean(cfg.password),
      shelfName:   cfg.shelfName || '',
      lastSync:    lastSyncDoc?.calibrePush?.pushedAt || null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/users/calibre
router.put('/calibre', requireAuth, async (req, res) => {
  try {
    const { enabled, url, username, password, shelfName } = req.body;
    const user = await User.findById(req.user.id).select('calibreWeb');
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    const existing = user.calibreWeb || {};
    const updates = {
      'calibreWeb.enabled':    enabled !== undefined ? Boolean(enabled) : existing.enabled,
      'calibreWeb.url':        url !== undefined ? url : existing.url,
      'calibreWeb.username':   username !== undefined ? username : existing.username,
      'calibreWeb.shelfName':  shelfName !== undefined ? shelfName.trim() : (existing.shelfName || ''),
    };
    if (password) updates['calibreWeb.password'] = encrypt(password);
    await User.findByIdAndUpdate(req.user.id, { $set: updates });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/users/calibre/test
router.post('/calibre/test', requireAuth, async (req, res) => {
  try {
    let { url, username, password } = req.body;

    // Si aucun mot de passe fourni (déjà sauvegardé), utiliser celui en BDD
    if (!password) {
      const user = await User.findById(req.user.id).select('calibreWeb');
      if (user?.calibreWeb?.password) password = decrypt(user.calibreWeb.password);
      if (!url      && user?.calibreWeb?.url)      url      = user.calibreWeb.url;
      if (!username && user?.calibreWeb?.username) username = user.calibreWeb.username;
    }

    const result = await testCalibreConnection({ url, username, password });
    res.json(result);
  } catch (err) {
    res.status(500).json({ connected: false, error: err.message });
  }
});

// POST /api/users/calibre/sync — push all completed requests not yet sent to Calibre
router.post('/calibre/sync', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('calibreWeb');
    if (!user?.calibreWeb?.enabled) {
      return res.status(400).json({ error: 'Calibre-Web non configuré ou désactivé' });
    }

    // Demandes complétées avec un fichier, pas encore envoyées avec succès
    const requests = await BookRequest.find({
      user: req.user.id,
      status: 'completed',
      filePath: { $exists: true, $ne: '' },
      'calibrePush.status': { $ne: 'success' },
    });

    if (!requests.length) {
      return res.json({ pushed: 0, failed: 0, skipped: 0, message: 'Aucun livre à synchroniser' });
    }

    let pushed = 0, failed = 0, skipped = 0;
    const { existsSync } = await import('fs');

    for (const request of requests) {
      try {
        const filePath = path.join(__dirname, '../../uploads', request.filePath);

        // Fichier introuvable → skip silencieux
        if (!existsSync(filePath)) {
          skipped++;
          console.warn(`[Calibre] Sync skip "${request.title}": fichier introuvable`);
          continue;
        }

        await pushToCalibre(user, filePath, request.title);
        request.calibrePush = { status: 'success', error: null, pushedAt: new Date() };
        await request.save();
        pushed++;
        console.log(`[Calibre] Sync ✓ "${request.title}"`);
      } catch (err) {
        request.calibrePush = { status: 'failed', error: err.message, pushedAt: new Date() };
        await request.save();
        failed++;
        console.error(`[Calibre] Sync ✗ "${request.title}": ${err.message}`);
      }
    }

    const lastSync = pushed > 0 ? new Date() : null;
    res.json({ pushed, failed, skipped, total: requests.length, lastSync });
  } catch (err) {
    console.error('[Calibre] sync error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;