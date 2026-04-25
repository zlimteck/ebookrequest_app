import express from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import ConnectorSettings from '../models/ConnectorSettings.js';
import { testConnection } from '../services/lazyLibrarianService.js';
import { testConnectionMylar } from '../services/mylar3Service.js';
import { testConnectionValentine } from '../services/valentineService.js';

const router = express.Router();

// ── GET /api/connectors/lazylibrarian ─────────────────────────────────────────
router.get('/lazylibrarian', requireAuth, requireAdmin, async (req, res) => {
  try {
    let doc = await ConnectorSettings.findOne({ service: 'lazylibrarian' }).lean();
    if (!doc) doc = { service: 'lazylibrarian', enabled: false, url: '', apiKey: '' };
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── PUT /api/connectors/lazylibrarian ─────────────────────────────────────────
router.put('/lazylibrarian', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { enabled, url, apiKey } = req.body;
    const doc = await ConnectorSettings.findOneAndUpdate(
      { service: 'lazylibrarian' },
      { enabled: !!enabled, url: url?.trim() || '', apiKey: apiKey?.trim() || '' },
      { upsert: true, new: true, runValidators: true }
    );
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la sauvegarde' });
  }
});

// ── POST /api/connectors/lazylibrarian/test ───────────────────────────────────
router.post('/lazylibrarian/test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { url, apiKey } = req.body;
    if (!url || !apiKey) {
      return res.status(400).json({ error: 'URL et clé API requis pour le test' });
    }
    const data = await testConnection(url.trim(), apiKey.trim());
    const version = data.version ? ` v${data.version}` : '';
    res.json({ success: true, message: `Connexion réussie — LazyLibrarian${version}` });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Connexion impossible' });
  }
});

// ── GET /api/connectors/mylar3 ────────────────────────────────────────────────
router.get('/mylar3', requireAuth, requireAdmin, async (req, res) => {
  try {
    let doc = await ConnectorSettings.findOne({ service: 'mylar3' }).lean();
    if (!doc) doc = { service: 'mylar3', enabled: false, url: '', apiKey: '' };
    res.json(doc);
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── PUT /api/connectors/mylar3 ────────────────────────────────────────────────
router.put('/mylar3', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { enabled, url, apiKey, comicVineApiKey } = req.body;
    const doc = await ConnectorSettings.findOneAndUpdate(
      { service: 'mylar3' },
      {
        enabled: !!enabled,
        url: url?.trim() || '',
        apiKey: apiKey?.trim() || '',
        comicVineApiKey: comicVineApiKey?.trim() || '',
      },
      { upsert: true, new: true, runValidators: true }
    );
    res.json(doc);
  } catch {
    res.status(500).json({ error: 'Erreur lors de la sauvegarde' });
  }
});

// ── POST /api/connectors/mylar3/test ─────────────────────────────────────────
router.post('/mylar3/test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { url, apiKey } = req.body;
    if (!url || !apiKey) {
      return res.status(400).json({ error: 'URL et clé API requis pour le test' });
    }
    await testConnectionMylar(url.trim(), apiKey.trim());
    res.json({ success: true, message: 'Connexion réussie — Mylar3' });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Connexion impossible' });
  }
});

// ── GET /api/connectors/valentine ─────────────────────────────────────────────
router.get('/valentine', requireAuth, requireAdmin, async (req, res) => {
  try {
    let doc = await ConnectorSettings.findOne({ service: 'valentine' }).lean();
    if (!doc) doc = { service: 'valentine', enabled: false, url: 'https://valentine.wtf', username: '', password: '' };
    // Never send the password back to the client — send a placeholder if set
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

    // Only update password if a new one was provided (not the placeholder)
    if (password && password !== '••••••••') {
      update.password = password;
    }
    // If no password field and _hasPassword is false, clear it
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
    // If placeholder password, load real one from DB
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