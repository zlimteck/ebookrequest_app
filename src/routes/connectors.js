import express from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import ConnectorSettings from '../models/ConnectorSettings.js';
import { testConnectionValentine } from '../services/valentineService.js';
import { getNextScanTime } from '../services/valentineCron.js';

const router = express.Router();

// ── GET /api/connectors/valentine/next-scan ───────────────────────────────────
router.get('/valentine/next-scan', requireAuth, requireAdmin, (req, res) => {
  res.json({ nextScanAt: getNextScanTime() });
});

// ── GET /api/connectors/valentine ─────────────────────────────────────────────
router.get('/valentine', requireAuth, requireAdmin, async (req, res) => {
  try {
    let doc = await ConnectorSettings.findOne({ service: 'valentine' }).lean();
    if (!doc) doc = { service: 'valentine', enabled: false, url: 'https://valentine.wtf', username: '', password: '' };
    res.json({
      ...doc,
      password: doc.password ? '••••••••' : '',
      _hasPassword: !!doc.password,
    });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── PUT /api/connectors/valentine ─────────────────────────────────────────────
router.put('/valentine', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { enabled, url, username, password, _hasPassword } = req.body;

    const update = {
      enabled: !!enabled,
      url: url?.trim() || 'https://valentine.wtf',
      username: username?.trim() || '',
    };

    if (password && password !== '••••••••') {
      update.password = password;
    }
    if (!password && !_hasPassword) {
      update.password = '';
    }

    const doc = await ConnectorSettings.findOneAndUpdate(
      { service: 'valentine' },
      update,
      { upsert: true, new: true, runValidators: true }
    );

    res.json({
      ...doc.toObject(),
      password: doc.password ? '••••••••' : '',
      _hasPassword: !!doc.password,
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
      realPassword = doc?.password || '';
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

export default router;