import express from 'express';
import crypto from 'crypto';
import { requireAuth } from '../middleware/auth.js';
import { updateUserProfile, verifyEmail, getCurrentUser, changePassword, updateAvatar, getUserStats } from '../controllers/userController.js';
import User from '../models/User.js';
import { encrypt, decrypt } from '../services/cryptoService.js';
import { testCalibreConnection, pushToCalibre, getSessionCookie, listShelves, addToShelves, reconcileShelves, getBookShelfMembership, resolveCalibreBookId } from '../services/calibreService.js';
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
      enabled:         cfg.enabled || false,
      url:             cfg.url || '',
      username:        cfg.username || '',
      hasPassword:     Boolean(cfg.password),
      shelves:         (cfg.shelves || []).map(s => ({ name: s.name, isDefault: s.isDefault })),
      apiFlavor:       cfg.apiFlavor || '',
      apiFlavorSource: cfg.apiFlavorSource || 'auto',
      lastSync:        lastSyncDoc?.calibrePush?.pushedAt || null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/users/calibre
router.put('/calibre', requireAuth, async (req, res) => {
  try {
    const { enabled, url, username, password, shelves, apiFlavor } = req.body;
    const user = await User.findById(req.user.id).select('calibreWeb');
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    const existing = user.calibreWeb || {};
    const updates = {
      'calibreWeb.enabled':  enabled !== undefined ? Boolean(enabled) : existing.enabled,
      'calibreWeb.url':      url !== undefined ? url : existing.url,
      'calibreWeb.username': username !== undefined ? username : existing.username,
    };
    if (Array.isArray(shelves)) {
      updates['calibreWeb.shelves'] = shelves
        .filter(s => s && typeof s.name === 'string' && s.name.trim())
        .map(s => ({ name: s.name.trim(), isDefault: Boolean(s.isDefault) }));
    }
    // apiFlavor === '' signifie "repasser en auto" ; toute autre valeur = forçage manuel
    if (apiFlavor !== undefined) {
      updates['calibreWeb.apiFlavor'] = apiFlavor || '';
      updates['calibreWeb.apiFlavorSource'] = apiFlavor ? 'manual' : 'auto';
    }
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

    // Mémorise le flavor détecté, sauf si l'admin l'a forcé manuellement.
    if (result.connected && result.detectedFlavor) {
      const user = await User.findById(req.user.id).select('calibreWeb.apiFlavorSource');
      if ((user?.calibreWeb?.apiFlavorSource || 'auto') === 'auto') {
        await User.updateOne({ _id: req.user.id }, { $set: { 'calibreWeb.apiFlavor': result.detectedFlavor } });
      }
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ connected: false, error: err.message });
  }
});

// GET /api/users/calibre/shelves — liste les étagères existantes côté serveur
// Calibre-Web de l'utilisateur (pour peupler les cases à cocher du formulaire
// de recherche et de la modale a posteriori du dashboard).
router.get('/calibre/shelves', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('calibreWeb');
    const cfg = user?.calibreWeb;
    if (!cfg?.enabled || !cfg?.url) {
      return res.status(400).json({ error: 'Calibre-Web non configuré ou désactivé' });
    }
    const url = cfg.url.replace(/\/$/, '');
    const rawPassword = cfg.password || '';
    const password = decrypt(rawPassword) ?? rawPassword;
    if (!cfg.username || !password) {
      return res.status(400).json({ error: 'Identifiants Calibre-Web manquants' });
    }

    const cookie = await getSessionCookie(url, cfg.username, password);
    const { shelves, detectedFlavor } = await listShelves(url, cookie, cfg.apiFlavor || '');

    // Même logique de mémorisation auto que /calibre/test.
    if (detectedFlavor && detectedFlavor !== cfg.apiFlavor && (cfg.apiFlavorSource || 'auto') === 'auto') {
      await User.updateOne({ _id: req.user.id }, { $set: { 'calibreWeb.apiFlavor': detectedFlavor } });
    }

    res.json({ shelves, detectedFlavor });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Impossible de récupérer les étagères' });
  }
});

// GET /api/users/calibre/requests/:id/shelves — état réel d'appartenance du
// livre à ses étagères, interrogé côté serveur Calibre-Web (pas notre propre
// enregistrement, qui peut être périmé si le livre a été retiré d'une
// étagère directement dans Calibre). Sert à pré-cocher la modale du
// dashboard avec la vérité du moment plutôt qu'un état mis en cache.
router.get('/calibre/requests/:id/shelves', requireAuth, async (req, res) => {
  try {
    const [user, request] = await Promise.all([
      User.findById(req.user.id).select('calibreWeb'),
      BookRequest.findOne({ _id: req.params.id, user: req.user.id }),
    ]);
    if (!request) return res.status(404).json({ error: 'Demande introuvable' });
    const cfg = user?.calibreWeb;
    if (!cfg?.enabled || !cfg?.url) {
      return res.status(400).json({ error: 'Calibre-Web non configuré ou désactivé' });
    }

    const url = cfg.url.replace(/\/$/, '');
    const rawPassword = cfg.password || '';
    const password = decrypt(rawPassword) ?? rawPassword;
    const cookie = await getSessionCookie(url, cfg.username, password);

    const calibreBookId = await resolveCalibreBookId(request, url, cfg.username, password);
    if (!calibreBookId) {
      // Pas encore dans Calibre (ou introuvable) — pas d'erreur, juste rien à afficher ;
      // le front retombe sur les étagères par défaut du profil dans ce cas.
      return res.json({ shelves: null, calibreBookId: null });
    }

    const { shelves: knownShelves, detectedFlavor } = await listShelves(url, cookie, cfg.apiFlavor || '');
    const membership = await getBookShelfMembership(url, cookie, calibreBookId, {
      flavorHint: cfg.apiFlavor || detectedFlavor,
      shelvesWithIds: knownShelves,
    });

    // membership === null : la vérification a échoué (serveur inaccessible,
    // page introuvable…) — on le signale plutôt que d'affirmer "aucune étagère".
    res.json({ shelves: membership, calibreBookId });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Impossible de vérifier les étagères' });
  }
});

// POST /api/users/calibre/requests/:id/shelves — envoie (ou ré-envoie) un livre
// déjà complété vers les étagères choisies, a posteriori. N'effectue PAS de
// ré-upload : utilise le calibreBookId déjà connu si disponible, sinon le
// retrouve par recherche de titre (comme le fait pushToCalibre en interne).
router.post('/calibre/requests/:id/shelves', requireAuth, async (req, res) => {
  try {
    const { shelves } = req.body;
    if (!Array.isArray(shelves)) {
      return res.status(400).json({ error: 'Liste d\'étagères manquante' });
    }

    const [user, request] = await Promise.all([
      User.findById(req.user.id).select('calibreWeb'),
      BookRequest.findOne({ _id: req.params.id, user: req.user.id }),
    ]);
    if (!request) return res.status(404).json({ error: 'Demande introuvable' });
    const cfg = user?.calibreWeb;
    if (!cfg?.enabled || !cfg?.url) {
      return res.status(400).json({ error: 'Calibre-Web non configuré ou désactivé' });
    }
    if (request.status !== 'completed' || !request.filePath) {
      return res.status(400).json({ error: 'Cette demande n\'est pas encore disponible dans Calibre' });
    }

    const url = cfg.url.replace(/\/$/, '');
    const rawPassword = cfg.password || '';
    const password = decrypt(rawPassword) ?? rawPassword;
    const cookie = await getSessionCookie(url, cfg.username, password);

    let csrfToken = null;
    try {
      const { default: axios } = await import('axios');
      const page = await axios.get(`${url}/me`, { headers: { Cookie: cookie }, validateStatus: s => s < 500 });
      const m = (page.data || '').match(/name="csrf_token"[^>]*value="([^"]+)"/);
      if (m) csrfToken = m[1];
    } catch {}

    const calibreBookId = await resolveCalibreBookId(request, url, cfg.username, password);
    if (!calibreBookId) {
      return res.status(404).json({ error: 'Livre introuvable côté Calibre-Web — relancez un envoi complet depuis les Réglages.' });
    }

    // État réel juste avant d'agir, pas notre enregistrement potentiellement périmé —
    // sinon un retrait fait directement dans Calibre serait ignoré au prochain envoi
    // (la case resterait cochée dans notre historique, donc "rien à changer" à tort).
    const { shelves: knownShelves, detectedFlavor } = await listShelves(url, cookie, cfg.apiFlavor || '');
    const liveMembership = await getBookShelfMembership(url, cookie, calibreBookId, {
      flavorHint: cfg.apiFlavor || detectedFlavor,
      shelvesWithIds: knownShelves,
    });
    // Si la vérification échoue, on retombe sur notre dernier enregistrement
    // plutôt que de bloquer l'action.
    const previousNames = liveMembership !== null ? liveMembership : (request.selectedShelves || []);

    const shelfResult = await reconcileShelves(url, cookie, csrfToken, previousNames, shelves, calibreBookId);

    request.selectedShelves = shelves;
    request.calibrePush = {
      status: shelfResult.failed.length ? 'partial' : 'success',
      error: shelfResult.failed.length
        ? `Échec sur : ${shelfResult.failed.map(f => `${f.name} (${f.action === 'remove' ? 'retrait' : 'ajout'})`).join(', ')}`
        : null,
      pushedAt: new Date(),
      calibreBookId,
    };
    await request.save();

    res.json({ success: true, ...shelfResult, calibreBookId });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erreur lors de l\'envoi vers les étagères' });
  }
});

// POST /api/users/calibre/sync — traite les demandes complétées non totalement
// synchronisées : upload complet pour celles jamais envoyées ou en échec total,
// et juste un retry d'étagère (sans ré-upload) pour celles en statut 'partial'.
router.post('/calibre/sync', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('calibreWeb');
    if (!user?.calibreWeb?.enabled) {
      return res.status(400).json({ error: 'Calibre-Web non configuré ou désactivé' });
    }

    const requests = await BookRequest.find({
      user: req.user.id,
      status: 'completed',
      filePath: { $exists: true, $ne: '' },
      'calibrePush.status': { $nin: ['success'] },
    });

    if (!requests.length) {
      return res.json({ pushed: 0, failed: 0, skipped: 0, message: 'Aucun livre à synchroniser' });
    }

    let pushed = 0, failed = 0, skipped = 0;
    const { existsSync } = await import('fs');
    const url = user.calibreWeb.url.replace(/\/$/, '');
    const rawPassword = user.calibreWeb.password || '';
    const password = decrypt(rawPassword) ?? rawPassword;

    for (const request of requests) {
      try {
        const defaultShelves = (user.calibreWeb.shelves || []).filter(s => s.isDefault).map(s => s.name);
        const shelfNames = request.selectedShelves !== undefined ? request.selectedShelves : defaultShelves;

        if (request.calibrePush?.status === 'partial' && request.calibrePush?.calibreBookId) {
          // Livre déjà dans Calibre — on ne retente que les étagères manquantes.
          const cookie = await getSessionCookie(url, user.calibreWeb.username, password);
          const shelfResult = await addToShelves(url, cookie, null, shelfNames, request.calibrePush.calibreBookId);
          request.calibrePush = {
            status: shelfResult.failed.length ? 'partial' : 'success',
            error: shelfResult.failed.length ? `Étagère(s) en échec : ${shelfResult.failed.map(f => f.name).join(', ')}` : null,
            pushedAt: new Date(),
            calibreBookId: request.calibrePush.calibreBookId,
          };
          await request.save();
          pushed++;
          console.log(`[Calibre] Sync (étagère seule) ✓ "${request.title}"`);
          continue;
        }

        const filePath = path.join(__dirname, '../../uploads', request.filePath);
        if (!existsSync(filePath)) {
          skipped++;
          console.warn(`[Calibre] Sync skip "${request.title}": fichier introuvable`);
          continue;
        }

        const result = await pushToCalibre(user, filePath, request.title, shelfNames);
        const hasShelfFailures = result?.shelfResult?.failed?.length > 0;
        request.calibrePush = {
          status: hasShelfFailures ? 'partial' : 'success',
          error: hasShelfFailures ? `Étagère(s) en échec : ${result.shelfResult.failed.map(f => f.name).join(', ')}` : null,
          pushedAt: new Date(),
          calibreBookId: result?.calibreBookId ?? null,
        };
        await request.save();
        pushed++;
        console.log(`[Calibre] Sync ✓ "${request.title}"`);
      } catch (err) {
        request.calibrePush = { status: 'failed', error: err.message, pushedAt: new Date(), calibreBookId: request.calibrePush?.calibreBookId || null };
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

// ── Valentine routes (credentials personnels user) ────────────────────────────

// GET /api/users/valentine
router.get('/valentine', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('valentine');
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    res.json({
      username:    user.valentine?.username || '',
      hasPassword: Boolean(user.valentine?.password),
    });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/users/valentine
router.put('/valentine', requireAuth, async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findById(req.user.id).select('valentine');
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    const updates = {};
    if (username !== undefined) updates['valentine.username'] = username.trim();
    if (password)               updates['valentine.password'] = encrypt(password);
    // Si username vide → supprimer les credentials
    if (username?.trim() === '' && !password) {
      updates['valentine.username'] = '';
      updates['valentine.password'] = '';
    }

    await User.findByIdAndUpdate(req.user.id, { $set: updates });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/users/valentine/quota
router.get('/valentine/quota', requireAuth, async (req, res) => {
  try {
    const { getValentineQuota } = await import('../services/valentineService.js');
    const user = await User.findById(req.user.id).select('valentine');
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    const raw = user?.valentine?.password || '';
    const password = decrypt(raw) ?? raw;
    const username = user?.valentine?.username || '';

    if (!username || !password) {
      return res.status(400).json({ error: 'Aucun compte Valentine configuré' });
    }

    const quota = await getValentineQuota(username, password);
    res.json(quota);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erreur lors de la récupération du quota' });
  }
});

// POST /api/users/valentine/test
router.post('/valentine/test', requireAuth, async (req, res) => {
  try {
    const { testConnectionValentine } = await import('../services/valentineService.js');
    let { username, password } = req.body;

    if (!password || password === '••••••••') {
      const user = await User.findById(req.user.id).select('valentine');
      const raw = user?.valentine?.password || '';
      password = decrypt(raw) ?? raw;
      if (!username) username = user?.valentine?.username || '';
    }

    if (!username || !password) {
      return res.status(400).json({ error: 'Identifiant et mot de passe requis' });
    }

    await testConnectionValentine(username.trim(), password);
    res.json({ success: true, message: 'Connexion réussie — valentine.wtf' });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Connexion impossible' });
  }
});

// GET /api/users/hardcover
router.get('/hardcover', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('hardcover');
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    res.json({
      enabled: user.hardcover?.enabled ?? false,
      apiKey: user.hardcover?.apiKey ? '••••••••' : '',
      _hasApiKey: !!user.hardcover?.apiKey,
      _keyUpdatedAt: user.hardcover?.apiKey ? user.hardcover?.apiKeySavedAt : null,
    });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/users/hardcover
router.put('/hardcover', requireAuth, async (req, res) => {
  try {
    const { enabled, apiKey, _hasApiKey } = req.body;
    const updates = { 'hardcover.enabled': !!enabled };

    // apiKey n'est touchée que si le champ est explicitement présent dans la requête
    // (le toggle "activer" seul n'envoie que { enabled }, pour ne jamais risquer
    // d'effacer une clé déjà enregistrée par erreur d'état côté front).
    if (apiKey !== undefined) {
      if (apiKey && apiKey !== '••••••••') {
        updates['hardcover.apiKey'] = encrypt(apiKey);
        updates['hardcover.apiKeySavedAt'] = new Date();
      } else if (!apiKey && !_hasApiKey) {
        updates['hardcover.apiKey'] = '';
        updates['hardcover.apiKeySavedAt'] = null;
      }
    }

    const user = await User.findByIdAndUpdate(req.user.id, { $set: updates }, { new: true }).select('hardcover');
    res.json({
      enabled: user.hardcover?.enabled ?? false,
      apiKey: user.hardcover?.apiKey ? '••••••••' : '',
      _hasApiKey: !!user.hardcover?.apiKey,
      _keyUpdatedAt: user.hardcover?.apiKey ? user.hardcover?.apiKeySavedAt : null,
    });
  } catch {
    res.status(500).json({ error: 'Erreur lors de la sauvegarde' });
  }
});

// POST /api/users/hardcover/test
router.post('/hardcover/test', requireAuth, async (req, res) => {
  try {
    let { apiKey } = req.body;
    if (!apiKey || apiKey === '••••••••') {
      const user = await User.findById(req.user.id).select('hardcover');
      const raw = user?.hardcover?.apiKey || '';
      apiKey = decrypt(raw) ?? raw;
    }
    if (!apiKey) return res.status(400).json({ error: 'Clé API non renseignée' });

    const response = await fetch('https://api.hardcover.app/v1/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query: '{ me { username } }' }),
    });
    const data = await response.json();
    if (!response.ok || data?.errors) {
      const reason = data?.errors?.[0]?.message || `HTTP ${response.status}`;
      return res.status(400).json({ error: reason });
    }
    res.json({ success: true, message: 'Clé Hardcover valide' });
  } catch (err) {
    res.status(500).json({ error: `Test impossible : ${err.message || 'Erreur inconnue'}` });
  }
});

// POST /api/users/hardcover/sync-now
router.post('/hardcover/sync-now', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('_id username hardcover');
    if (!user?.hardcover?.enabled || !user?.hardcover?.apiKey) {
      return res.status(400).json({ error: 'Synchro Hardcover non activée' });
    }
    // Peut prendre plusieurs minutes sur une grosse bibliothèque (rate-limit Hardcover
    // respecté par hardcoverSyncService) — on répond tout de suite, ça tourne en fond.
    const { syncUserLibrary } = await import('../services/hardcoverSyncCron.js');
    syncUserLibrary(user, { force: true }).catch(err => {
      console.warn(`[HardcoverSync] Échec synchro manuelle pour ${user.username}:`, err.message);
    });
    res.json({ success: true, message: 'Synchronisation lancée en arrière-plan — ça peut prendre quelques minutes.' });
  } catch {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/users/hardcover/import
router.post('/hardcover/import', requireAuth, async (req, res) => {
  try {
    const { importHardcoverLibrary } = await import('../services/hardcoverSyncService.js');
    const result = await importHardcoverLibrary(req.user.id);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({
      success: true,
      message: `${result.imported} livre(s) importé(s), ${result.skipped} déjà présent(s) dans votre bibliothèque.`,
      ...result,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erreur lors de l\'import' });
  }
});

export default router;