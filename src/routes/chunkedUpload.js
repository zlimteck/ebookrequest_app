import express from 'express';
import multer from 'multer';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { initUpload, saveChunk, reassembleChunks, abortUpload } from '../services/chunkUploadService.js';
import { promoteUploadedFile } from '../services/fileStorageService.js';
import ConnectorSettings from '../models/ConnectorSettings.js';

// Upload en mémoire pour les chunks (petits, ~20 Mo côté client) : jamais écrits tels
// quels sur disque par multer, c'est chunkUploadService qui gère l'écriture/assemblage
// dans uploads/books. Réservé aux admins (upload manuel de demande + gestionnaire de
// fichiers), jamais exposé à un user standard.
const chunkUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const router = express.Router();
router.use(requireAuth, requireAdmin);

// POST /api/admin/chunked-upload/init — { filename } -> { uploadId }
// (JSON déjà parsé globalement par express.json() dans src/index.js)
router.post('/init', (req, res) => {
  try {
    const { filename } = req.body;
    if (!filename) return res.status(400).json({ error: 'Nom de fichier requis.' });
    const uploadId = initUpload(filename);
    res.json({ uploadId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/admin/chunked-upload/chunk — multipart: chunk (binaire), uploadId, index
router.post('/chunk', chunkUpload.single('chunk'), (req, res) => {
  try {
    const { uploadId, index } = req.body;
    if (!uploadId || index === undefined || !req.file) {
      return res.status(400).json({ error: 'uploadId, index et chunk sont requis.' });
    }
    saveChunk(uploadId, Number(index), req.file.buffer);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Statut de la promotion vers le stockage distant par uploadId — en mémoire,
// même pattern que `migrationStatus` dans admin.js (un seul process, pas de
// besoin de persistance). Promotion vers S3/WebDAV d'un fichier déjà
// reconstitué localement pouvant prendre plus de temps qu'un timeout de
// proxy pour un gros fichier (100+ Mo), elle n'est jamais attendue dans la
// requête `/finalize` elle-même, contrairement à avant.
const promotionStatus = new Map();

// POST /api/admin/chunked-upload/finalize — { uploadId, totalChunks, filename }
// -> { filePath, promoted } ; si `promoted` est false, le fichier est déjà
// utilisable (il est toujours écrit en local d'abord) mais pas encore promu
// vers le stockage distant configuré — suivre via /finalize/status/:uploadId.
router.post('/finalize', async (req, res) => {
  try {
    const { uploadId, totalChunks, filename } = req.body;
    if (!uploadId || !totalChunks || !filename) {
      return res.status(400).json({ error: 'uploadId, totalChunks et filename sont requis.' });
    }
    const { destPath, filePath } = await reassembleChunks(uploadId, Number(totalChunks), filename);

    const storageDoc = await ConnectorSettings.findOne({ service: 'bookStorage' }).select('fileStorageMode').lean();
    if ((storageDoc?.fileStorageMode || 'local') === 'local') {
      return res.json({ success: true, filePath, promoted: true });
    }

    promotionStatus.set(uploadId, { done: false, error: null });
    res.json({ success: true, filePath, promoted: false });
    promoteUploadedFile(destPath, filePath)
      .then(() => promotionStatus.set(uploadId, { done: true, error: null }))
      .catch(err => promotionStatus.set(uploadId, { done: true, error: err.message || 'Erreur lors de l\'envoi vers le stockage distant.' }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/admin/chunked-upload/finalize/status/:uploadId
router.get('/finalize/status/:uploadId', (req, res) => {
  const status = promotionStatus.get(req.params.uploadId) || { done: true, error: null };
  res.json(status);
});

// POST /api/admin/chunked-upload/abort — { uploadId }
router.post('/abort', (req, res) => {
  const { uploadId } = req.body;
  if (uploadId) abortUpload(uploadId);
  res.json({ success: true });
});

export default router;
