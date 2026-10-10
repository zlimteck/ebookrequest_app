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
import { exportBackup, restoreBackup } from '../services/backupService.js';
import { BACKUP_DIR, listBackups, restartBackupCron } from '../services/backupCron.js';
import { uploadRemoteBackup, testRemoteBackupConnection } from '../services/remoteBackupService.js';
import { encrypt, decrypt } from '../services/cryptoService.js';
import ConnectorSettings from '../models/ConnectorSettings.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

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

// ── Export/sauvegarde des données (issue #43) ───────────────────────────────
// GET /api/admin/backup/export — zip téléchargé directement par le navigateur.
router.get('/backup/export', async (req, res) => {
  try {
    const zipBuffer = await exportBackup();
    const filename = `ebookrequest-backup-${new Date().toISOString().slice(0, 10)}.zip`;
    res.setHeader('Content-Type', 'application/zip');
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
    const result = await restoreBackup(req.file.buffer);

    const adminUser = req.user;
    await AdminLog.create({
      admin: adminUser.id,
      adminUsername: adminUser.username || 'admin',
      action: 'restore_backup',
      details: `Sauvegarde du ${result.exportedAt} restaurée (${result.restored.map(r => `${r.name}: ${r.count}`).join(', ')})`,
    }).catch(() => {});

    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Erreur restauration backup:', err);
    res.status(500).json({ error: err.message || 'Erreur lors de la restauration.' });
  }
});

// ── Sauvegarde automatique périodique (issue #43) ───────────────────────────
// GET /api/admin/backup/auto-config
router.get('/backup/auto-config', async (req, res) => {
  try {
    const doc = await ConnectorSettings.findOne({ service: 'backup' }).lean();
    res.json({
      enabled: doc?.enabled ?? false,
      cronInterval: doc?.cronInterval || 24,
      backupRetentionCount: doc?.backupRetentionCount || 7,
      remoteBackupType: doc?.remoteBackupType || '',
      remoteBackupWebdavUrl: doc?.remoteBackupWebdavUrl || '',
      remoteBackupWebdavUsername: doc?.remoteBackupWebdavUsername || '',
      remoteBackupWebdavPassword: doc?.password ? '••••••••' : '',
      _hasRemoteBackupWebdavPassword: !!doc?.password,
      remoteBackupS3Endpoint: doc?.remoteBackupS3Endpoint || '',
      remoteBackupS3Bucket: doc?.remoteBackupS3Bucket || '',
      remoteBackupS3Region: doc?.remoteBackupS3Region || 'auto',
      remoteBackupS3AccessKeyId: doc?.remoteBackupS3AccessKeyId || '',
      remoteBackupS3Prefix: doc?.remoteBackupS3Prefix || '',
      remoteBackupS3SecretAccessKey: doc?.apiKey ? '••••••••' : '',
      _hasRemoteBackupS3SecretAccessKey: !!doc?.apiKey,
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/admin/backup/auto-config
router.put('/backup/auto-config', async (req, res) => {
  try {
    const {
      enabled, cronInterval, backupRetentionCount, remoteBackupType,
      remoteBackupWebdavUrl, remoteBackupWebdavUsername, remoteBackupWebdavPassword, _hasRemoteBackupWebdavPassword,
      remoteBackupS3Endpoint, remoteBackupS3Bucket, remoteBackupS3Region, remoteBackupS3AccessKeyId, remoteBackupS3Prefix,
      remoteBackupS3SecretAccessKey, _hasRemoteBackupS3SecretAccessKey,
    } = req.body;

    const update = {
      enabled: !!enabled,
      cronInterval: Number(cronInterval) || 24,
      backupRetentionCount: Math.max(1, Number(backupRetentionCount) || 7),
      remoteBackupType: ['webdav', 's3'].includes(remoteBackupType) ? remoteBackupType : '',
      remoteBackupWebdavUrl: remoteBackupWebdavUrl?.trim() || '',
      remoteBackupWebdavUsername: remoteBackupWebdavUsername?.trim() || '',
      remoteBackupS3Endpoint: remoteBackupS3Endpoint?.trim() || '',
      remoteBackupS3Bucket: remoteBackupS3Bucket?.trim() || '',
      remoteBackupS3Region: remoteBackupS3Region?.trim() || 'auto',
      remoteBackupS3AccessKeyId: remoteBackupS3AccessKeyId?.trim() || '',
      remoteBackupS3Prefix: remoteBackupS3Prefix?.trim() || '',
    };
    // Mots de passe/clés secrètes : champ partagé `password`/`apiKey` déjà
    // utilisés ailleurs sur ce schéma pour d'autres services, même pattern
    // que les autres connecteurs (garder si vide + déjà enregistré, effacer
    // explicitement sinon).
    if (remoteBackupWebdavPassword && remoteBackupWebdavPassword !== '••••••••') update.password = encrypt(remoteBackupWebdavPassword);
    if (!remoteBackupWebdavPassword && !_hasRemoteBackupWebdavPassword) update.password = '';
    if (remoteBackupS3SecretAccessKey && remoteBackupS3SecretAccessKey !== '••••••••') update.apiKey = encrypt(remoteBackupS3SecretAccessKey);
    if (!remoteBackupS3SecretAccessKey && !_hasRemoteBackupS3SecretAccessKey) update.apiKey = '';

    await ConnectorSettings.findOneAndUpdate(
      { service: 'backup' }, update, { upsert: true, runValidators: true }
    );
    await restartBackupCron();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la sauvegarde du réglage.' });
  }
});

// POST /api/admin/backup/remote/test — teste la destination distante avec les
// valeurs du formulaire (pas forcément déjà enregistrées), même pattern que
// les boutons "Tester" des autres connecteurs.
router.post('/backup/remote/test', async (req, res) => {
  try {
    const {
      remoteBackupType, remoteBackupWebdavUrl, remoteBackupWebdavUsername, remoteBackupWebdavPassword,
      remoteBackupS3Endpoint, remoteBackupS3Bucket, remoteBackupS3Region, remoteBackupS3AccessKeyId, remoteBackupS3Prefix, remoteBackupS3SecretAccessKey,
    } = req.body;

    await testRemoteBackupConnection({
      remoteBackupType,
      remoteBackupWebdavUrl,
      remoteBackupWebdavUsername,
      remoteBackupPasswordPlain: remoteBackupWebdavPassword !== '••••••••' ? remoteBackupWebdavPassword : undefined,
      remoteBackupS3Endpoint,
      remoteBackupS3Bucket,
      remoteBackupS3Region,
      remoteBackupS3AccessKeyId,
      remoteBackupS3Prefix,
      remoteBackupS3SecretPlain: remoteBackupS3SecretAccessKey !== '••••••••' ? remoteBackupS3SecretAccessKey : undefined,
    });
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
    const zipBuffer = await exportBackup();
    const filename = `ebookrequest-backup-auto-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
    fs.writeFileSync(path.join(BACKUP_DIR, filename), zipBuffer);
    try {
      await uploadRemoteBackup(zipBuffer, filename);
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
  if (!/^[a-zA-Z0-9_-]+\.zip$/.test(filename)) {
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
  if (!/^[a-zA-Z0-9_-]+\.zip$/.test(filename)) {
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