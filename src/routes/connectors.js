import express from 'express';
import fetch from 'node-fetch';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import ConnectorSettings from '../models/ConnectorSettings.js';
import AdminLog from '../models/AdminLog.js';
import BookRequest from '../models/BookRequest.js';
import DownloadLog from '../models/DownloadLog.js';
import User from '../models/User.js';
import { sendKindleDelivery } from '../services/emailService.js';
import { testConnectionValentine, searchOnValentine, downloadFromValentineById, getValentineQuota } from '../services/valentineService.js';
import { invalidateAdminEmailPrefsCache } from '../controllers/bookRequestController.js';
import { getNextScanTime, restartCronInterval } from '../services/valentineCron.js';
import { searchOnAnnasArchive, getAnnasArchiveConfig, saveAnnasArchiveConfig, downloadFromAnnas, pingAnnasArchive } from '../services/annasArchiveService.js';
import { encrypt, decrypt } from '../services/cryptoService.js';
import { invalidateGoogleBooksKeyCache, getGoogleBooksApiKey } from '../services/googleBooksConfig.js';
import { invalidateHardcoverKeyCache } from '../services/hardcoverConfig.js';
import { invalidateAIProviderConfigCache } from '../services/aiProviderConfig.js';
import { testAIProviderConnection } from '../services/aiProviderService.js';
import { invalidateRSSUrlCache } from '../services/rssConfig.js';
import { invalidateProxyConfigCache, getProxyAgent } from '../services/proxyConfig.js';
import { invalidateEmailConfigCache } from '../services/emailConfig.js';

async function triggerKindleIfEnabled(bookRequestLean) {
  try {
    if (!bookRequestLean?.filePath || !bookRequestLean?.user) return;
    const user = await User.findById(bookRequestLean.user)
      .select('kindleEmail emailVerified notificationPreferences');
    if (!user?.emailVerified || !user?.kindleEmail || !user?.notificationPreferences?.kindle?.enabled) return;
    const uploadsRoot = path.resolve(__dirname, '../../uploads');
    const absolutePath = path.resolve(uploadsRoot, bookRequestLean.filePath);
    if (!absolutePath.startsWith(uploadsRoot + path.sep) || !fs.existsSync(absolutePath)) return;
    const filename = path.basename(absolutePath);
    sendKindleDelivery(user.kindleEmail, absolutePath, filename)
      .then(() => console.log(`[Kindle] Envoyé à ${user.kindleEmail} : ${filename}`))
      .catch(e => console.error('[Kindle] Erreur envoi:', e.message));
  } catch (e) {
    console.error('[Kindle] Erreur déclenchement:', e.message);
  }
}

const router = express.Router();

// Journalise un changement de toggle "activer" dans Réglages (visible dans Logs Admin)
// Le JWT ne porte pas `username` (seulement id/role/sid) — il faut le résoudre en base,
// comme le fait déjà logAdminAction() dans bookRequestController.js.
async function logSettingsToggle(req, serviceLabel, enabled) {
  try {
    const admin = await User.findById(req.user.id).select('username').lean();
    await AdminLog.create({
      admin: req.user.id,
      adminUsername: admin?.username || 'admin',
      action: 'settings_change',
      details: `${serviceLabel} ${enabled ? 'activé' : 'désactivé'}`,
    });
  } catch (err) {
    console.error('[AdminLog] Erreur log settings_change:', err.message);
  }
}

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
      directSearchEnabled: doc.directSearchEnabled ?? true,
    });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── PUT /api/connectors/valentine ─────────────────────────────────────────────
router.put('/valentine', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { enabled, url, username, password, _hasPassword, cronInterval, valentineFallbackToAdmin, directSearchEnabled } = req.body;

    const update = {
      enabled: !!enabled,
      url: url?.trim() || 'https://valentine.wtf',
      username: username?.trim() || '',
      cronInterval: Number(cronInterval) || 6,
      valentineFallbackToAdmin: !!valentineFallbackToAdmin,
      directSearchEnabled: directSearchEnabled !== false,
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
    const doc = await ConnectorSettings.findOne({ service: 'valentine' }).lean();
    if (!doc?.enabled) return res.json({ results: [], disabled: true });
    const results = await searchOnValentine(q);
    res.json({ results });
  } catch (err) {
    // 200 volontaire : le front distingue « aucun résultat » de « source injoignable »
    res.json({ results: [], unavailable: true, error: err.message });
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
    if (br?.status === 'completed') triggerKindleIfEnabled(br);
    res.json({ success: true, ...result });
  } catch (err) {
    const br = await BookRequest.findById(requestId).lean().catch(() => null);
    await DownloadLog.create({ bookRequestId: requestId, title: br?.title || '', author: br?.author || '', username: br?.username || '', connector: 'valentine', success: false, error: err.message.slice(0, 500), triggeredBy: 'admin' }).catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/connectors/libgen ───────────────────────────────────────────────
router.get('/libgen', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { getLibgenConfig } = await import('../services/libgenService.js');
    const doc = await getLibgenConfig();
    res.json({ enabled: doc.enabled, url: doc.url });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── PUT /api/connectors/libgen ───────────────────────────────────────────────
router.put('/libgen', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { saveLibgenConfig } = await import('../services/libgenService.js');
    const { enabled, url } = req.body;
    const doc = await saveLibgenConfig({ enabled, url });
    if (enabled !== undefined) logSettingsToggle(req, 'LibGen', doc.enabled);
    res.json({ enabled: doc.enabled, url: doc.url });
  } catch {
    res.status(500).json({ error: 'Erreur lors de la sauvegarde' });
  }
});

// ── GET /api/connectors/libgen/search?q=... ──────────────────────────────────
router.get('/libgen/search', requireAuth, requireAdmin, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Paramètre q requis' });
  try {
    const { getLibgenConfig, searchOnLibgen } = await import('../services/libgenService.js');
    if (!(await getLibgenConfig()).enabled) {
      return res.json({ results: [], baseUrl: null, disabled: true });
    }
    const { results, baseUrl } = await searchOnLibgen(q);
    res.json({ results, baseUrl });
  } catch (err) {
    // 200 volontaire : le front distingue « aucun résultat » de « source injoignable »
    res.json({ results: [], baseUrl: null, unavailable: true, error: err.message });
  }
});

// ── GET /api/connectors/libgen/ping ──────────────────────────────────────────
router.get('/libgen/ping', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { pingLibgen } = await import('../services/libgenService.js');
    const { baseUrl } = await pingLibgen();
    res.json({ ok: true, baseUrl });
  } catch (err) {
    res.status(503).json({ ok: false, error: err.message });
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
    const { reachable, searchable } = await pingAnnasArchive();
    res.json({ ok: reachable, searchable });
  } catch (err) {
    res.status(503).json({ ok: false, searchable: false, error: err.message });
  }
});

// ── GET /api/connectors/annasarchive/search?q=... ─────────────────────────────
router.get('/annasarchive/search', requireAuth, requireAdmin, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'Paramètre q requis' });

  // Recherche manuelle : chaque source a sa propre section côté UI (comme Valentine),
  // donc pas de repli en chaîne ici — c'est le rôle de l'orchestrateur pour l'auto-DL.
  const annasCfg = await getAnnasArchiveConfig().catch(() => ({}));
  if (!annasCfg.enabled) return res.json({ results: [], baseUrl: null, disabled: true });

  let annasErr = null;
  try {
    const { results, baseUrl } = await searchOnAnnasArchive(q);
    if (results.length) return res.json({ results, baseUrl, source: 'annasarchive' });
  } catch (err) {
    annasErr = err;
  }

  // On répond 200 même en cas d'échec, avec un lien de recherche manuelle : le navigateur
  // de l'admin passe le challenge DDoS-Guard que les solveurs ne passent pas. Un 500 serait
  // converti en « aucun résultat » par le front, masquant la différence entre « rien
  // trouvé » et « source inaccessible ».
  const annasBase = (annasCfg.url || 'https://annas-archive.gl').replace(/\/$/, '');
  const params = new URLSearchParams({ q });
  if (annasCfg.lang) params.set('lang', annasCfg.lang);

  res.json({
    results: [],
    baseUrl: null,
    source: 'annasarchive',
    manualSearchUrl: `${annasBase}/search?${params.toString()}`,
    unavailable: !!annasErr,
    error: annasErr ? annasErr.message : null,
  });
});

// ── POST /api/connectors/annasarchive/download ────────────────────────────────
router.post('/annasarchive/download', requireAuth, requireAdmin, async (req, res) => {
  const { md5, requestId, format } = req.body;
  if (!md5 || !requestId) return res.status(400).json({ error: 'md5 et requestId requis' });
  try {
    const result = await downloadFromAnnas(md5, requestId, format || null);
    const br = await BookRequest.findById(requestId).lean();
    await DownloadLog.create({ bookRequestId: requestId, title: br?.title || '', author: br?.author || '', username: br?.username || '', connector: 'annasarchive', success: true, triggeredBy: 'admin' });
    if (result && br?.status === 'completed') triggerKindleIfEnabled(br);
    res.json({ success: true, ...result });
  } catch (err) {
    const br = await BookRequest.findById(requestId).lean().catch(() => null);
    await DownloadLog.create({ bookRequestId: requestId, title: br?.title || '', author: br?.author || '', username: br?.username || '', connector: 'annasarchive', success: false, error: err.message.slice(0, 500), triggeredBy: 'admin' }).catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/connectors/googlebooks ───────────────────────────────────────────
router.get('/googlebooks', requireAuth, requireAdmin, async (req, res) => {
  try {
    let doc = await ConnectorSettings.findOne({ service: 'googleBooks' }).lean();
    // Migration transparente : importe la clé du .env en base au premier accès,
    // pour que les instances existantes voient leur config déjà pré-remplie.
    if (!doc && process.env.GOOGLE_BOOKS_API_KEY) {
      doc = await ConnectorSettings.findOneAndUpdate(
        { service: 'googleBooks' },
        { $setOnInsert: { enabled: true, apiKey: encrypt(process.env.GOOGLE_BOOKS_API_KEY) } },
        { upsert: true, new: true, runValidators: true }
      ).lean();
      invalidateGoogleBooksKeyCache();
    }
    res.json({
      enabled: doc?.enabled ?? false,
      apiKey: doc?.apiKey ? '••••••••' : '',
      _hasApiKey: !!doc?.apiKey,
    });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── PUT /api/connectors/googlebooks ───────────────────────────────────────────
router.put('/googlebooks', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { enabled, apiKey, _hasApiKey } = req.body;
    // `enabled` n'est touché que si le champ est explicitement présent dans la requête
    // (le toggle "activer" l'envoie seul ; "Enregistrer" ne l'envoie plus du tout, pour
    // ne jamais risquer de réécrire ce réglage avec une valeur obsolète).
    const update = enabled !== undefined ? { enabled: !!enabled } : {};

    if (apiKey && apiKey !== '••••••••') {
      update.apiKey = encrypt(apiKey);
    }
    if (!apiKey && !_hasApiKey) {
      update.apiKey = '';
    }

    const doc = await ConnectorSettings.findOneAndUpdate(
      { service: 'googleBooks' },
      update,
      { upsert: true, new: true, runValidators: true }
    );
    invalidateGoogleBooksKeyCache();
    if (enabled !== undefined) logSettingsToggle(req, 'Google Books', doc.enabled);

    res.json({
      enabled: doc.enabled,
      apiKey: doc.apiKey ? '••••••••' : '',
      _hasApiKey: !!doc.apiKey,
    });
  } catch {
    res.status(500).json({ error: 'Erreur lors de la sauvegarde' });
  }
});

// ── POST /api/connectors/googlebooks/test ─────────────────────────────────────
router.post('/googlebooks/test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { apiKey } = req.body;
    let realKey = apiKey;
    if (apiKey === '••••••••') {
      const doc = await ConnectorSettings.findOne({ service: 'googleBooks' }).lean();
      realKey = decrypt(doc?.apiKey || '') ?? doc?.apiKey ?? '';
    }
    if (!realKey) return res.status(400).json({ error: 'Clé API non renseignée' });

    // Retry sur 503 (throttling passager côté Google) pour éviter les faux négatifs
    // sur une clé pourtant valide.
    let response, data, lastNetworkErr;
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        response = await fetch(`https://www.googleapis.com/books/v1/volumes?q=test&maxResults=1&key=${encodeURIComponent(realKey)}`, { timeout: 8000 });
        try {
          data = await response.json();
        } catch {
          data = null; // réponse non-JSON (ex: page d'erreur HTML pendant une panne Google)
        }
        lastNetworkErr = null;
      } catch (fetchErr) {
        lastNetworkErr = fetchErr;
        response = null;
      }
      if ((response?.ok) || (response && response.status !== 503) || attempt === maxAttempts - 1) break;
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
    }

    if (lastNetworkErr) {
      const reason = lastNetworkErr.code ? `${lastNetworkErr.code} — ${lastNetworkErr.message}` : lastNetworkErr.message;
      return res.status(502).json({ error: `Connexion à Google Books impossible : ${reason}` });
    }
    if (!response.ok) {
      const reason = data?.error?.errors?.[0]?.reason || data?.error?.status || (data ? `HTTP ${response.status}` : `HTTP ${response.status} (réponse non-JSON)`);
      return res.status(400).json({ error: reason });
    }
    res.json({ success: true, message: 'Clé Google Books valide' });
  } catch (err) {
    const reason = err.code ? `${err.code} — ${err.message}` : (err.message || 'Erreur inconnue');
    res.status(500).json({ error: `Test impossible : ${reason}` });
  }
});

// ── GET /api/connectors/hardcover ─────────────────────────────────────────────
router.get('/hardcover', requireAuth, requireAdmin, async (req, res) => {
  try {
    const doc = await ConnectorSettings.findOne({ service: 'hardcover' }).lean();
    res.json({
      enabled: doc?.enabled ?? false,
      apiKey: doc?.apiKey ? '••••••••' : '',
      _hasApiKey: !!doc?.apiKey,
      _keyUpdatedAt: doc?.apiKey ? doc?.updatedAt : null,
    });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── PUT /api/connectors/hardcover ─────────────────────────────────────────────
router.put('/hardcover', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { enabled, apiKey, _hasApiKey } = req.body;
    const update = enabled !== undefined ? { enabled: !!enabled } : {};

    if (apiKey && apiKey !== '••••••••') {
      update.apiKey = encrypt(apiKey);
    }
    if (!apiKey && !_hasApiKey) {
      update.apiKey = '';
    }

    const doc = await ConnectorSettings.findOneAndUpdate(
      { service: 'hardcover' },
      update,
      { upsert: true, new: true, runValidators: true }
    );
    invalidateHardcoverKeyCache();
    if (enabled !== undefined) logSettingsToggle(req, 'Hardcover', doc.enabled);

    res.json({
      enabled: doc.enabled,
      apiKey: doc.apiKey ? '••••••••' : '',
      _hasApiKey: !!doc.apiKey,
      _keyUpdatedAt: doc.apiKey ? doc.updatedAt : null,
    });
  } catch {
    res.status(500).json({ error: 'Erreur lors de la sauvegarde' });
  }
});

// ── POST /api/connectors/hardcover/test ───────────────────────────────────────
router.post('/hardcover/test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { apiKey } = req.body;
    let realKey = apiKey;
    if (apiKey === '••••••••') {
      const doc = await ConnectorSettings.findOne({ service: 'hardcover' }).lean();
      realKey = decrypt(doc?.apiKey || '') ?? doc?.apiKey ?? '';
    }
    if (!realKey) return res.status(400).json({ error: 'Clé API non renseignée' });

    let response, data;
    try {
      response = await fetch('https://api.hardcover.app/v1/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: realKey.startsWith('Bearer ') ? realKey : `Bearer ${realKey}`,
        },
        body: JSON.stringify({ query: '{ me { id } }' }),
        timeout: 8000,
      });
      data = await response.json();
    } catch (fetchErr) {
      const reason = fetchErr.code ? `${fetchErr.code} — ${fetchErr.message}` : fetchErr.message;
      return res.status(502).json({ error: `Connexion à Hardcover impossible : ${reason}` });
    }

    if (!response.ok || data?.errors) {
      const reason = data?.errors?.[0]?.message || `HTTP ${response.status}`;
      return res.status(400).json({ error: reason });
    }
    res.json({ success: true, message: 'Clé Hardcover valide' });
  } catch (err) {
    res.status(500).json({ error: `Test impossible : ${err.message || 'Erreur inconnue'}` });
  }
});

// ── GET /api/connectors/aiprovider ────────────────────────────────────────────
router.get('/aiprovider', requireAuth, requireAdmin, async (req, res) => {
  try {
    let doc = await ConnectorSettings.findOne({ service: 'aiProvider' }).lean();
    // Migration transparente : importe le provider/clé du .env en base au premier accès.
    if (!doc && process.env.AI_PROVIDER) {
      const provider = process.env.AI_PROVIDER;
      const seed = { provider };
      if (provider === 'openai' && process.env.OPENAI_API_KEY) {
        seed.enabled = true;
        seed.apiKey = encrypt(process.env.OPENAI_API_KEY);
        seed.model = process.env.OPENAI_MODEL || '';
      } else if (provider === 'claude' && process.env.ANTHROPIC_API_KEY) {
        seed.enabled = true;
        seed.apiKey = encrypt(process.env.ANTHROPIC_API_KEY);
        seed.model = process.env.CLAUDE_MODEL || '';
      } else if (provider === 'ollama' && process.env.OLLAMA_URL) {
        seed.enabled = true;
        seed.url = process.env.OLLAMA_URL;
        seed.model = process.env.OLLAMA_MODEL || '';
      }
      if (seed.enabled) {
        doc = await ConnectorSettings.findOneAndUpdate(
          { service: 'aiProvider' },
          { $setOnInsert: seed },
          { upsert: true, new: true, runValidators: true }
        ).lean();
        invalidateAIProviderConfigCache();
      }
    }
    res.json({
      enabled: doc?.enabled ?? false,
      provider: doc?.provider || 'openai',
      model: doc?.model || '',
      url: doc?.url || '',
      apiKey: doc?.apiKey ? '••••••••' : '',
      _hasApiKey: !!doc?.apiKey,
    });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── PUT /api/connectors/aiprovider ────────────────────────────────────────────
router.put('/aiprovider', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { enabled, provider, model, url, apiKey, _hasApiKey } = req.body;
    if (!['openai', 'ollama', 'claude'].includes(provider)) {
      return res.status(400).json({ error: 'Provider invalide' });
    }

    const update = {
      provider,
      model: model?.trim() || '',
      url: url?.trim() || '',
      ...(enabled !== undefined && { enabled: !!enabled }),
    };

    if (apiKey && apiKey !== '••••••••') {
      update.apiKey = encrypt(apiKey);
    }
    if (!apiKey && !_hasApiKey) {
      update.apiKey = '';
    }

    const doc = await ConnectorSettings.findOneAndUpdate(
      { service: 'aiProvider' },
      update,
      { upsert: true, new: true, runValidators: true }
    );
    invalidateAIProviderConfigCache();
    if (enabled !== undefined) logSettingsToggle(req, 'Fournisseur IA', doc.enabled);

    res.json({
      enabled: doc.enabled,
      provider: doc.provider,
      model: doc.model || '',
      url: doc.url || '',
      apiKey: doc.apiKey ? '••••••••' : '',
      _hasApiKey: !!doc.apiKey,
    });
  } catch {
    res.status(500).json({ error: 'Erreur lors de la sauvegarde' });
  }
});

// ── POST /api/connectors/aiprovider/test ──────────────────────────────────────
router.post('/aiprovider/test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { provider, model, url, apiKey } = req.body;
    if (!['openai', 'ollama', 'claude'].includes(provider)) {
      return res.status(400).json({ error: 'Provider invalide' });
    }

    let realKey = apiKey;
    if (apiKey === '••••••••') {
      const doc = await ConnectorSettings.findOne({ service: 'aiProvider' }).lean();
      realKey = decrypt(doc?.apiKey || '') ?? doc?.apiKey ?? '';
    }

    const cfg = {
      provider,
      openaiApiKey: provider === 'openai' ? realKey : '',
      openaiModel: provider === 'openai' ? (model || 'gpt-4o-mini') : 'gpt-4o-mini',
      anthropicApiKey: provider === 'claude' ? realKey : '',
      claudeModel: provider === 'claude' ? (model || 'claude-opus-4-5') : 'claude-opus-4-5',
      ollamaUrl: provider === 'ollama' ? url : '',
      ollamaModel: provider === 'ollama' ? model : '',
    };

    const result = await testAIProviderConnection(cfg);
    if (!result.connected) {
      return res.status(400).json({ error: result.error || 'Connexion impossible' });
    }
    res.json({ success: true, message: `Connexion réussie — ${provider}`, model: result.model });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Test impossible' });
  }
});

// ── GET /api/connectors/manual-mode ───────────────────────────────────────────
// Recherche "Manuelle" (point d'entrée à blanc) — pas un connecteur externe,
// mais suit le même schéma générique { enabled } que RSS/Valentine pour
// cohérence. Formulaire partagé avec la recherche détaillée (pré-rempli après
// sélection) non affecté — seul le bouton d'entrée à blanc est concerné.
router.get('/manual-mode', requireAuth, requireAdmin, async (req, res) => {
  try {
    const doc = await ConnectorSettings.findOne({ service: 'manualMode' }).lean();
    res.json({ enabled: doc?.enabled ?? true });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── PUT /api/connectors/manual-mode ───────────────────────────────────────────
router.put('/manual-mode', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { enabled } = req.body;
    const doc = await ConnectorSettings.findOneAndUpdate(
      { service: 'manualMode' },
      { enabled: !!enabled },
      { upsert: true, new: true, runValidators: true }
    );
    logSettingsToggle(req, 'Recherche manuelle', doc.enabled);
    res.json({ enabled: doc.enabled });
  } catch {
    res.status(500).json({ error: 'Erreur lors de la sauvegarde' });
  }
});

// ── GET /api/connectors/rss ───────────────────────────────────────────────────
router.get('/rss', requireAuth, requireAdmin, async (req, res) => {
  try {
    let doc = await ConnectorSettings.findOne({ service: 'rss' }).lean();
    // Migration transparente : importe l'URL du .env en base au premier accès.
    if (!doc && process.env.RSS_FEED_URL) {
      doc = await ConnectorSettings.findOneAndUpdate(
        { service: 'rss' },
        { $setOnInsert: { enabled: true, url: process.env.RSS_FEED_URL } },
        { upsert: true, new: true, runValidators: true }
      ).lean();
      invalidateRSSUrlCache();
    }
    res.json({
      enabled: doc?.enabled ?? false,
      url: doc?.url || '',
    });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── PUT /api/connectors/rss ────────────────────────────────────────────────────
router.put('/rss', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { enabled, url } = req.body;
    const doc = await ConnectorSettings.findOneAndUpdate(
      { service: 'rss' },
      { url: url?.trim() || '', ...(enabled !== undefined && { enabled: !!enabled }) },
      { upsert: true, new: true, runValidators: true }
    );
    invalidateRSSUrlCache();
    if (enabled !== undefined) logSettingsToggle(req, 'Flux RSS', doc.enabled);
    res.json({ enabled: doc.enabled, url: doc.url || '' });
  } catch {
    res.status(500).json({ error: 'Erreur lors de la sauvegarde' });
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
      notifyOnProviderIssue: doc.notifyOnProviderIssue  ?? true,
    });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── PUT /api/connectors/email ─────────────────────────────────────────────────
router.put('/email', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { enabled, notifyOnNewRequest, notifyOnComplete, notifyOnCancel, notifyOnComment, notifyOnReport, notifyOnNewUser, notifyOnDownloadFailed, notifyOnProviderIssue } = req.body;
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
        notifyOnProviderIssue: notifyOnProviderIssue !== false,
      },
      { upsert: true, new: true }
    );
    invalidateAdminEmailPrefsCache();
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Erreur lors de la sauvegarde' });
  }
});

// ── GET /api/connectors/proxy ──────────────────────────────────────────────────
router.get('/proxy', requireAuth, requireAdmin, async (req, res) => {
  try {
    const doc = await ConnectorSettings.findOne({ service: 'proxy' }).lean();
    res.json({
      enabled: doc?.enabled ?? false,
      url: doc?.url || '',
      mode: doc?.provider === 'default' ? 'default' : 'fallback',
      username: doc?.username || '',
      password: doc?.password ? '••••••••' : '',
      _hasPassword: !!doc?.password,
    });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── PUT /api/connectors/proxy ──────────────────────────────────────────────────
router.put('/proxy', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { enabled, url, mode, username, password, _hasPassword } = req.body;

    if (enabled && !url?.trim()) {
      return res.status(400).json({ error: 'URL du proxy requise' });
    }

    const update = {
      url: url?.trim() || '',
      provider: mode === 'default' ? 'default' : 'fallback',
      username: username?.trim() || '',
      ...(enabled !== undefined && { enabled: !!enabled }),
    };
    if (password && password !== '••••••••') {
      update.password = encrypt(password);
    }
    if (!password && !_hasPassword) {
      update.password = '';
    }

    const doc = await ConnectorSettings.findOneAndUpdate(
      { service: 'proxy' },
      update,
      { upsert: true, new: true, runValidators: true }
    );
    invalidateProxyConfigCache();
    if (enabled !== undefined) logSettingsToggle(req, 'Proxy sortant', doc.enabled);

    res.json({
      enabled: doc.enabled,
      url: doc.url,
      mode: doc.provider === 'default' ? 'default' : 'fallback',
      username: doc.username,
      password: doc.password ? '••••••••' : '',
      _hasPassword: !!doc.password,
    });
  } catch {
    res.status(500).json({ error: 'Erreur lors de la sauvegarde' });
  }
});

// ── POST /api/connectors/proxy/test ────────────────────────────────────────────
router.post('/proxy/test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { url, username, password } = req.body;
    if (!url?.trim()) return res.status(400).json({ error: 'URL du proxy requise' });

    let realPassword = password;
    if (password === '••••••••') {
      const doc = await ConnectorSettings.findOne({ service: 'proxy' }).lean();
      realPassword = decrypt(doc?.password || '') ?? doc?.password ?? '';
    }

    let proxyUrl = url.trim();
    if (username) {
      const u = new URL(proxyUrl);
      u.username = username;
      u.password = realPassword || '';
      proxyUrl = u.toString();
    }

    // Test réel avec la clé Google Books configurée : sans clé, Google renvoie un
    // 429 de quota anonyme (0 requête/jour) qui n'a rien à voir avec le proxy lui-même.
    const apiKey = await getGoogleBooksApiKey();
    const testUrl = `https://www.googleapis.com/books/v1/volumes?q=test&maxResults=1${apiKey ? `&key=${encodeURIComponent(apiKey)}` : ''}`;

    const response = await fetch(testUrl, {
      agent: getProxyAgent(proxyUrl),
      timeout: 10000,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      const reason = data?.error?.errors?.[0]?.reason || data?.error?.status || `HTTP ${response.status}`;
      return res.status(400).json({ error: `Le proxy répond mais la requête a échoué (${reason})` });
    }
    res.json({ success: true, message: 'Proxy fonctionnel' });
  } catch (err) {
    const reason = err.code ? `${err.code} — ${err.message}` : (err.message || 'Erreur inconnue');
    res.status(400).json({ error: `Connexion via proxy impossible : ${reason}` });
  }
});

// ── GET /api/connectors/emailprovider ──────────────────────────────────────────
router.get('/emailprovider', requireAuth, requireAdmin, async (req, res) => {
  try {
    let doc = await ConnectorSettings.findOne({ service: 'emailProvider' }).lean();
    // Migration transparente : importe la config email du .env en base au premier accès.
    if (!doc && process.env.EMAIL_PROVIDER) {
      const provider = (process.env.EMAIL_PROVIDER || 'smtp').toLowerCase();
      const seed = { provider };
      if (provider === 'resend' && process.env.RESEND_API_KEY) {
        seed.enabled = true;
        seed.apiKey = encrypt(process.env.RESEND_API_KEY);
      } else if (provider === 'smtp' && process.env.SMTP_HOST) {
        seed.enabled = true;
        seed.smtpHost = process.env.SMTP_HOST;
        seed.smtpPort = parseInt(process.env.SMTP_PORT, 10) || 465;
        seed.smtpSecure = process.env.SMTP_SECURE === 'true';
        seed.username = process.env.SMTP_USER || '';
        if (process.env.SMTP_PASSWORD) seed.apiKey = encrypt(process.env.SMTP_PASSWORD);
      }
      seed.fromAddress = process.env.EMAIL_FROM_ADDRESS || '';
      seed.fromName = process.env.EMAIL_FROM_NAME || '';
      if (seed.enabled) {
        doc = await ConnectorSettings.findOneAndUpdate(
          { service: 'emailProvider' },
          { $setOnInsert: seed },
          { upsert: true, new: true, runValidators: true }
        ).lean();
        invalidateEmailConfigCache();
      }
    }
    res.json({
      enabled: doc?.enabled ?? false,
      provider: doc?.provider || 'smtp',
      smtpHost: doc?.smtpHost || '',
      smtpPort: doc?.smtpPort || 465,
      smtpSecure: doc?.smtpSecure ?? false,
      username: doc?.username || '',
      fromAddress: doc?.fromAddress || '',
      fromName: doc?.fromName || '',
      apiKey: doc?.apiKey ? '••••••••' : '',
      _hasApiKey: !!doc?.apiKey,
    });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── PUT /api/connectors/emailprovider ──────────────────────────────────────────
router.put('/emailprovider', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { enabled, provider, smtpHost, smtpPort, smtpSecure, username, fromAddress, fromName, apiKey, _hasApiKey } = req.body;
    if (!['smtp', 'resend'].includes(provider)) {
      return res.status(400).json({ error: 'Provider invalide' });
    }

    const update = {
      provider,
      smtpHost: smtpHost?.trim() || '',
      smtpPort: Number(smtpPort) || 465,
      smtpSecure: !!smtpSecure,
      username: username?.trim() || '',
      fromAddress: fromAddress?.trim() || '',
      fromName: fromName?.trim() || '',
      ...(enabled !== undefined && { enabled: !!enabled }),
    };
    if (apiKey && apiKey !== '••••••••') {
      update.apiKey = encrypt(apiKey);
    }
    if (!apiKey && !_hasApiKey) {
      update.apiKey = '';
    }

    const doc = await ConnectorSettings.findOneAndUpdate(
      { service: 'emailProvider' },
      update,
      { upsert: true, new: true, runValidators: true }
    );
    invalidateEmailConfigCache();
    if (enabled !== undefined) logSettingsToggle(req, 'Fournisseur Email', doc.enabled);

    res.json({
      enabled: doc.enabled,
      provider: doc.provider,
      smtpHost: doc.smtpHost,
      smtpPort: doc.smtpPort,
      smtpSecure: doc.smtpSecure,
      username: doc.username,
      fromAddress: doc.fromAddress,
      fromName: doc.fromName,
      apiKey: doc.apiKey ? '••••••••' : '',
      _hasApiKey: !!doc.apiKey,
    });
  } catch {
    res.status(500).json({ error: 'Erreur lors de la sauvegarde' });
  }
});

// ── POST /api/connectors/emailprovider/test ────────────────────────────────────
router.post('/emailprovider/test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { to, provider, smtpHost, smtpPort, smtpSecure, username, fromAddress, fromName, apiKey } = req.body;
    if (!to?.trim()) return res.status(400).json({ error: 'Adresse email de destination requise' });

    let realKey = apiKey;
    if (apiKey === '••••••••') {
      const doc = await ConnectorSettings.findOne({ service: 'emailProvider' }).lean();
      realKey = decrypt(doc?.apiKey || '') ?? doc?.apiKey ?? '';
    }

    const from = `"${fromName || 'EbookRequest'}" <${fromAddress || 'noreply@example.com'}>`;

    if (provider === 'resend') {
      if (!realKey) return res.status(400).json({ error: 'Clé API Resend requise' });
      const { Resend } = await import('resend');
      const client = new Resend(realKey);
      const { error } = await client.emails.send({
        from,
        to: to.trim(),
        subject: 'Test EbookRequest',
        text: 'Ceci est un email de test envoyé depuis le panel admin EbookRequest.',
      });
      if (error) return res.status(400).json({ error: error.message || 'Erreur Resend' });
    } else {
      const { default: nodemailer } = await import('nodemailer');
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: Number(smtpPort) || 465,
        secure: !!smtpSecure,
        auth: { user: username, pass: realKey },
        tls: { rejectUnauthorized: false },
      });
      await transporter.sendMail({
        from,
        to: to.trim(),
        subject: 'Test EbookRequest',
        text: 'Ceci est un email de test envoyé depuis le panel admin EbookRequest.',
      });
    }

    res.json({ success: true, message: 'Email de test envoyé' });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Envoi impossible' });
  }
});

// ── GET /api/connectors/trending ──────────────────────────────────────────────
// Réglage du préchargement du cache "Découvrir" au démarrage du serveur (voir
// index.js / trendingBooksService.js). Séparé des autres connecteurs (ce n'est
// pas une source externe) mais suit le même modèle ConnectorSettings pour rester
// cohérent avec le reste du panel admin.
router.get('/trending', requireAuth, requireAdmin, async (req, res) => {
  try {
    const doc = await ConnectorSettings.findOne({ service: 'trending' }).lean();
    res.json({ preloadOnStartup: doc?.preloadOnStartup !== false });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── PUT /api/connectors/trending ──────────────────────────────────────────────
router.put('/trending', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { preloadOnStartup } = req.body;
    const doc = await ConnectorSettings.findOneAndUpdate(
      { service: 'trending' },
      { preloadOnStartup: !!preloadOnStartup },
      { upsert: true, new: true, runValidators: true }
    );
    res.json({ preloadOnStartup: doc.preloadOnStartup !== false });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;