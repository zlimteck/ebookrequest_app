import express from 'express';
import multer from 'multer';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { initUpload, saveChunk, finalizeUpload, abortUpload } from '../services/chunkUploadService.js';

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

// POST /api/admin/chunked-upload/finalize — { uploadId, totalChunks, filename } -> { filePath }
router.post('/finalize', (req, res) => {
  try {
    const { uploadId, totalChunks, filename } = req.body;
    if (!uploadId || !totalChunks || !filename) {
      return res.status(400).json({ error: 'uploadId, totalChunks et filename sont requis.' });
    }
    const result = finalizeUpload(uploadId, Number(totalChunks), filename);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/admin/chunked-upload/abort — { uploadId }
router.post('/abort', (req, res) => {
  const { uploadId } = req.body;
  if (uploadId) abortUpload(uploadId);
  res.json({ success: true });
});

export default router;
