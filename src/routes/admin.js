import express from 'express';
import crypto from 'crypto';
import multer from 'multer';
import { getAdminStats, getServicesHealth } from '../controllers/adminController.js';
import DownloadLog from '../models/DownloadLog.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { getLogBuffer, subscribeToLogs, unsubscribeFromLogs } from '../services/logBuffer.js';
import BookRequest from '../models/BookRequest.js';
import AdminLog from '../models/AdminLog.js';
import upload from '../middleware/upload.js';
import { exportBackup, restoreBackup, BackupValidationError } from '../services/backupService.js';
import { BACKUP_DIR, listBackups, restartBackupCron } from '../services/backupCron.js';
import {
  uploadRemoteBackup, testDestination,
  listDestinationsMasked, createDestination, updateDestination, deleteDestination,
} from '../services/remoteBackupService.js';
import ConnectorSettings from '../models/ConnectorSettings.js';
import { encrypt, decrypt } from '../services/cryptoService.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  listBookFiles, bookFileExists, renameBookFile, deleteBookFile, promoteUploadedFile,
  getStorageStats, copyAllLocalToRemote, invalidateBookStorageConfigCache,
} from '../services/fileStorageService.js';
import { createClient as createWebdavClient } from 'webdav';

// Stockage en mémoire pour le zip de restauration (jamais écrit sur disque,
// contrairement à `upload` qui écrit les ebooks dans uploads/books/) — un
// dump JSON texte même volumineux reste minuscule comparé à un ebook.
const backupUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

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

// Liste des fichiers dans le stockage ebooks configuré (local ou distant)
router.get('/uploads-list', async (req, res) => {
  try {
    const files = (await listBookFiles())
      .map(f => ({ name: f.name, filePath: `books/${f.name}`, size: f.size, modifiedAt: f.mtime }))
      .sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
    res.json({ success: true, files });
  } catch (err) {
    console.error('Erreur uploads-list:', err);
    res.status(500).json({ success: false, files: [] });
  }
});

// ── Gestionnaire de fichiers ─────────────────────────────────────────────────
// Distinct de /uploads-list (déjà utilisé par le sélecteur "fichier existant"
// à la création d'une demande) : renvoie aussi les demandes liées à chaque
// fichier, nécessaire pour l'avertissement avant suppression/renommage. Un
// même fichier physique peut être référencé par plusieurs BookRequest (étagères
// additionnelles multi-utilisateurs) — voir BookRequest.filePath.
// Empêche toute traversée de répertoire : le nom résolu doit rester un nom de
// fichier nu, jamais un chemin fourni par le client tel quel.
function resolveSafeFileName(name) {
  const safe = path.basename(String(name || ''));
  if (!safe || safe !== name) return null;
  return { safe, filePath: `books/${safe}` };
}

// ── Stockage distant des ebooks (issue #45) ─────────────────────────────────
// GET /api/admin/book-storage/config
router.get('/book-storage/config', async (req, res) => {
  try {
    const doc = await ConnectorSettings.findOne({ service: 'bookStorage' }).lean();
    res.json({
      fileStorageMode: doc?.fileStorageMode || 'local',
      bookStorageWebdavUrl: doc?.bookStorageWebdavUrl || '',
      bookStorageWebdavUsername: doc?.bookStorageWebdavUsername || '',
      _hasBookStorageWebdavPassword: !!doc?.bookStorageWebdavPassword,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/admin/book-storage/config
router.put('/book-storage/config', async (req, res) => {
  try {
    const { fileStorageMode, bookStorageWebdavUrl, bookStorageWebdavUsername, bookStorageWebdavPassword, _hasBookStorageWebdavPassword } = req.body;
    if (!['local', 'webdav', 's3'].includes(fileStorageMode)) {
      return res.status(400).json({ error: 'Mode de stockage invalide.' });
    }
    const update = {
      fileStorageMode,
      bookStorageWebdavUrl: bookStorageWebdavUrl || '',
      bookStorageWebdavUsername: bookStorageWebdavUsername || '',
    };
    // Même pattern que les autres secrets de ce schéma : garder le mot de
    // passe existant si le champ est laissé vide/masqué, l'effacer sinon.
    if (bookStorageWebdavPassword && bookStorageWebdavPassword !== '••••••••') {
      update.bookStorageWebdavPassword = encrypt(bookStorageWebdavPassword);
    } else if (!bookStorageWebdavPassword && !_hasBookStorageWebdavPassword) {
      update.bookStorageWebdavPassword = '';
    }
    await ConnectorSettings.findOneAndUpdate(
      { service: 'bookStorage' }, update, { upsert: true, runValidators: true }
    );
    invalidateBookStorageConfigCache();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la sauvegarde du réglage.' });
  }
});

// POST /api/admin/book-storage/test — teste la connexion WebDAV avec les
// valeurs du formulaire (enregistrées ou pas encore), même pattern que le
// test des destinations de sauvegarde distantes.
router.post('/book-storage/test', async (req, res) => {
  try {
    const { bookStorageWebdavUrl, bookStorageWebdavUsername, bookStorageWebdavPassword } = req.body;
    if (!bookStorageWebdavUrl) return res.status(400).json({ error: 'URL WebDAV requise.' });
    let password = bookStorageWebdavPassword;
    if (!password || password === '••••••••') {
      const doc = await ConnectorSettings.findOne({ service: 'bookStorage' }).lean();
      password = doc?.bookStorageWebdavPassword ? decrypt(doc.bookStorageWebdavPassword) : undefined;
    }
    const client = createWebdavClient(bookStorageWebdavUrl, {
      username: bookStorageWebdavUsername || undefined,
      password: password || undefined,
    });
    await client.getDirectoryContents('/');
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Connexion impossible.' });
  }
});

// POST /api/admin/book-storage/migrate — copie tous les fichiers locaux
// actuels (uploads/books) vers la destination distante actuellement
// configurée. Outil manuel, jamais déclenché automatiquement au changement
// de mode (l'admin doit savoir qu'un vrai transfert de fichiers a lieu).
router.post('/book-storage/migrate', async (req, res) => {
  try {
    const result = await copyAllLocalToRemote();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erreur lors de la migration.' });
  }
});

// GET /api/admin/book-storage/stats
router.get('/book-storage/stats', async (req, res) => {
  try {
    res.json(await getStorageStats());
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/files', async (req, res) => {
  try {
    const rawFiles = await listBookFiles();
    const relPaths = rawFiles.map(f => `books/${f.name}`);
    const linkedRequests = await BookRequest.find({ filePath: { $in: relPaths } })
      .select('title author username status filePath')
      .lean();
    const linkedByPath = new Map();
    for (const r of linkedRequests) {
      if (!linkedByPath.has(r.filePath)) linkedByPath.set(r.filePath, []);
      linkedByPath.get(r.filePath).push({ _id: r._id, title: r.title, author: r.author, username: r.username, status: r.status });
    }

    const files = rawFiles.map(f => {
      const filePath = `books/${f.name}`;
      return {
        name: f.name,
        filePath,
        size: f.size,
        modifiedAt: f.mtime,
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
    // multer écrit toujours d'abord dans uploads/books/ en local (middleware/
    // upload.js) ; promoteUploadedFile l'envoie vers le stockage réellement
    // configuré si un mode distant est actif, sans rien faire sinon.
    await promoteUploadedFile(req.file.path, `books/${req.file.filename}`);
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
    if (!from || !(await bookFileExists(from.filePath))) {
      return res.status(404).json({ success: false, error: 'Fichier introuvable.' });
    }
    const ext = path.extname(from.safe);
    const requestedNewName = String(newName || '').trim();
    if (!requestedNewName) return res.status(400).json({ success: false, error: 'Nouveau nom requis.' });
    const finalNewName = requestedNewName.toLowerCase().endsWith(ext.toLowerCase()) ? requestedNewName : `${requestedNewName}${ext}`;
    const to = resolveSafeFileName(finalNewName);
    if (!to) return res.status(400).json({ success: false, error: 'Nouveau nom invalide.' });
    if (await bookFileExists(to.filePath)) return res.status(409).json({ success: false, error: 'Un fichier porte déjà ce nom.' });

    await renameBookFile(from.filePath, to.filePath);

    const oldFilePath = from.filePath;
    const newFilePath = to.filePath;
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
    if (!target || !(await bookFileExists(target.filePath))) {
      return res.status(404).json({ success: false, error: 'Fichier introuvable.' });
    }
    const filePath = target.filePath;

    const linked = await BookRequest.find({ filePath }).select('title author username status').lean();
    if (linked.length && !confirm) {
      return res.json({ success: false, requiresConfirmation: true, linkedRequests: linked });
    }

    await deleteBookFile(filePath);

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

// ── Export/sauvegarde des données (issue #43) ───────────────────────────────
// POST /api/admin/backup/export — zip téléchargé directement par le
// navigateur. POST (pas GET) pour que le mot de passe optionnel passe dans le
// body plutôt que dans l'URL (query string loggée par défaut côté serveur/proxy).
router.post('/backup/export', async (req, res) => {
  try {
    const { password } = req.body || {};
    const zipBuffer = await exportBackup(password?.trim() || undefined);
    const filename = `ebookrequest-backup-${new Date().toISOString().slice(0, 10)}.zip${password ? '.enc' : ''}`;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(zipBuffer);
  } catch (err) {
    console.error('Erreur export backup:', err);
    res.status(500).json({ error: 'Erreur lors de la génération de la sauvegarde.' });
  }
});

// POST /api/admin/backup/restore — remplacement complet des données depuis un
// zip exporté par la route ci-dessus. Action destructive et irréversible,
// confirmation à double niveau gérée côté frontend avant cet appel.
router.post('/backup/restore', backupUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Aucun fichier reçu.' });
    }
    const result = await restoreBackup(req.file.buffer, req.body?.password?.trim() || undefined);

    const restoredAt = new Date();
    await ConnectorSettings.findOneAndUpdate(
      { service: 'backup' }, { lastRestoreAt: restoredAt }, { upsert: true }
    ).catch(() => {});

    const adminUser = req.user;
    await AdminLog.create({
      admin: adminUser.id,
      adminUsername: adminUser.username || 'admin',
      action: 'restore_backup',
      details: `Sauvegarde du ${result.exportedAt} restaurée (${result.restored.map(r => `${r.name}: ${r.count}`).join(', ')})`,
    }).catch(() => {});

    res.json({ success: true, ...result, lastRestoreAt: restoredAt });
  } catch (err) {
    console.error('Erreur restauration backup:', err);
    // 400 (pas 500) spécifiquement pour une faute utilisateur (mauvais mot de
    // passe, archive invalide/trop grosse) — une vraie panne serveur (ex.
    // transaction Mongo) reste 500.
    const status = err instanceof BackupValidationError ? 400 : 500;
    res.status(status).json({ error: err.message || 'Erreur lors de la restauration.' });
  }
});

// ── Sauvegarde automatique périodique (issue #43) ───────────────────────────
// GET /api/admin/backup/auto-config — réglages locaux uniquement (planning +
// rétention). Les destinations distantes sont gérées à part, voir plus bas.
router.get('/backup/auto-config', async (req, res) => {
  try {
    const doc = await ConnectorSettings.findOne({ service: 'backup' }).lean();
    res.json({
      enabled: doc?.enabled ?? false,
      cronInterval: doc?.cronInterval || 24,
      backupRetentionCount: doc?.backupRetentionCount || 7,
      _hasBackupEncryptionPassword: !!doc?.backupEncryptionPassword,
      lastRestoreAt: doc?.lastRestoreAt || null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/admin/backup/auto-config
router.put('/backup/auto-config', async (req, res) => {
  try {
    const { enabled, cronInterval, backupRetentionCount, backupEncryptionPassword, _hasBackupEncryptionPassword } = req.body;
    const update = {
      enabled: !!enabled,
      cronInterval: Number(cronInterval) || 24,
      backupRetentionCount: Math.max(1, Number(backupRetentionCount) || 7),
    };
    // Même pattern que les autres secrets de ce schéma : garder le mot de
    // passe existant si le champ est laissé vide/masqué, l'effacer
    // explicitement sinon.
    if (backupEncryptionPassword && backupEncryptionPassword !== '••••••••') {
      update.backupEncryptionPassword = encrypt(backupEncryptionPassword);
    } else if (!backupEncryptionPassword && !_hasBackupEncryptionPassword) {
      update.backupEncryptionPassword = '';
    }
    await ConnectorSettings.findOneAndUpdate(
      { service: 'backup' }, update, { upsert: true, runValidators: true }
    );
    await restartBackupCron();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la sauvegarde du réglage.' });
  }
});

// ── Destinations distantes multiples (issue #43 suite) ──────────────────────
// GET /api/admin/backup/destinations
router.get('/backup/destinations', async (req, res) => {
  try {
    res.json({ destinations: await listDestinationsMasked() });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/admin/backup/destinations — crée une nouvelle destination
router.post('/backup/destinations', async (req, res) => {
  try {
    const destination = await createDestination(req.body);
    res.json({ success: true, destination });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erreur lors de la création.' });
  }
});

// PUT /api/admin/backup/destinations/:id
router.put('/backup/destinations/:id', async (req, res) => {
  try {
    const destination = await updateDestination(req.params.id, req.body);
    res.json({ success: true, destination });
  } catch (err) {
    res.status(err.message === 'Destination introuvable.' ? 404 : 500).json({ error: err.message || 'Erreur lors de la sauvegarde.' });
  }
});

// DELETE /api/admin/backup/destinations/:id
router.delete('/backup/destinations/:id', async (req, res) => {
  try {
    await deleteDestination(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la suppression.' });
  }
});

// POST /api/admin/backup/destinations/test — teste une destination avec les
// valeurs du formulaire (enregistrée ou pas encore), même pattern que les
// boutons "Tester" des autres connecteurs.
router.post('/backup/destinations/test', async (req, res) => {
  try {
    await testDestination(req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Connexion impossible.' });
  }
});

// POST /api/admin/backup/auto-run-now — force une sauvegarde automatique
// immédiate, indépendamment du réglage `enabled` (cohérent avec le bouton
// "Vérifier maintenant" déjà utilisé pour Prowlarr). Envoie aussi vers la
// destination distante si configurée, comme le ferait le cron.
router.post('/backup/auto-run-now', async (req, res) => {
  try {
    const { backupRetentionCount, backupEncryptionPassword } = await ConnectorSettings.findOne({ service: 'backup' }).lean() || {};
    const password = backupEncryptionPassword ? decrypt(backupEncryptionPassword) : null;
    const zipBuffer = await exportBackup(password || undefined);
    const filename = `ebookrequest-backup-auto-${new Date().toISOString().replace(/[:.]/g, '-')}.zip${password ? '.enc' : ''}`;
    fs.writeFileSync(path.join(BACKUP_DIR, filename), zipBuffer);
    try {
      await uploadRemoteBackup(zipBuffer, filename, backupRetentionCount || 7);
    } catch (err) {
      console.error('[Backup] Échec de la copie distante:', err.message);
    }
    res.json({ success: true, filename });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la génération de la sauvegarde.' });
  }
});

// GET /api/admin/backup/history
router.get('/backup/history', (req, res) => {
  try {
    res.json({ backups: listBackups() });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/admin/backup/history/:filename — téléchargement d'une sauvegarde
// automatique passée. Filtre strict sur le nom (pas de traversal possible).
router.get('/backup/history/:filename', (req, res) => {
  const { filename } = req.params;
  if (!/^[a-zA-Z0-9_-]+\.zip(\.enc)?$/.test(filename)) {
    return res.status(400).json({ error: 'Nom de fichier invalide.' });
  }
  const filePath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Sauvegarde introuvable.' });
  }
  res.download(filePath);
});

// DELETE /api/admin/backup/history/:filename
router.delete('/backup/history/:filename', (req, res) => {
  const { filename } = req.params;
  if (!/^[a-zA-Z0-9_-]+\.zip(\.enc)?$/.test(filename)) {
    return res.status(400).json({ error: 'Nom de fichier invalide.' });
  }
  const filePath = path.join(BACKUP_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Sauvegarde introuvable.' });
  }
  fs.unlinkSync(filePath);
  res.json({ success: true });
});

export default router;