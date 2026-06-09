import express from 'express';
import {
  createBookRequest,
  getUserRequests,
  getAllRequests,
  updateRequestStatus,
  addDownloadLink,
  deleteRequest,
  markAsDownloaded,
  downloadEbook,
  reportRequest,
  getRequestQuota,
  updateAdminComment,
  updateUserComment,
  editUserRequest
} from '../controllers/bookRequestController.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import upload from '../middleware/upload.js';
import BookRequest from '../models/BookRequest.js';

const router = express.Router();

// ── Vérification doublon inter-utilisateurs ───────────────────────────────────
// Retourne la demande existante (d'un autre user) pour ce titre+auteur, si elle existe.
// Les demandes annulées sont ignorées (peuvent être re-demandées).
router.get('/check-duplicate', requireAuth, async (req, res) => {
  try {
    const { title, author } = req.query;
    if (!title || !author) return res.status(400).json({ success: false, duplicate: false });

    // Échapper les caractères spéciaux regex
    const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const existing = await BookRequest.findOne({
      user: { $ne: req.user.id },
      title: { $regex: `^${escRe(title.trim())}$`, $options: 'i' },
      author: { $regex: `^${escRe(author.trim())}$`, $options: 'i' },
      status: { $nin: ['canceled'] },
    }).select('status createdAt').lean();

    if (!existing) return res.json({ success: true, duplicate: false });

    return res.json({
      success: true,
      duplicate: true,
      status: existing.status,
      requestedAt: existing.createdAt,
    });
  } catch (err) {
    console.error('Erreur check-duplicate:', err);
    res.status(500).json({ success: false, duplicate: false });
  }
});

// Créer une nouvelle requête de livre
router.post('/', requireAuth, createBookRequest);

// Quota de demandes de l'utilisateur connecté
router.get('/quota', requireAuth, getRequestQuota);

// Récupérer les demandes de l'utilisateur connecté
router.get('/my-requests', requireAuth, getUserRequests);

// Récupérer toutes les demandes (admin uniquement)
router.get('/all', requireAuth, requireAdmin, getAllRequests);

// Mettre à jour le statut d'une demande (admin uniquement)
router.patch('/:id/status', requireAuth, requireAdmin, updateRequestStatus);

// Ajouter un lien de téléchargement ou uploader un fichier (admin uniquement)
router.patch('/:id/download-link',
  requireAuth,
  requireAdmin,
  upload.single('file'),
  addDownloadLink
);

// Télécharger un fichier ebook
router.get('/download/:id', requireAuth, downloadEbook);

// Marquer comme téléchargé
router.put('/:id/mark-downloaded', requireAuth, markAsDownloaded);

// Signaler un problème sur une demande
router.post('/:id/report', requireAuth, reportRequest);

router.delete('/:id', requireAuth, deleteRequest);
router.patch('/:id/user-edit', requireAuth, editUserRequest);

// Commentaire admin sur une demande
router.patch('/:id/comment', requireAuth, requireAdmin, updateAdminComment);

// Correction de catégorie par l'admin
router.patch('/:id/category', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { category } = req.body;
    if (!['ebook', 'manga', 'comic', ''].includes(category)) {
      return res.status(400).json({ error: 'Catégorie invalide' });
    }
    const BookRequest = (await import('../models/BookRequest.js')).default;
    const request = await BookRequest.findByIdAndUpdate(
      req.params.id,
      { $set: { category } },
      { new: true }
    );
    if (!request) return res.status(404).json({ error: 'Demande introuvable' });
    res.json({ success: true, category: request.category });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Commentaire utilisateur sur sa propre demande
router.patch('/:id/user-comment', requireAuth, updateUserComment);

// ── Conversion de format ──────────────────────────────────────────────────────

// GET /api/requests/:id/convert-formats — formats disponibles + taille du fichier source
router.get('/:id/convert-formats', requireAuth, async (req, res) => {
  try {
    const request = await BookRequest.findById(req.params.id).lean();
    if (!request) return res.status(404).json({ error: 'Demande introuvable' });

    const fp = request.filePath;
    if (!fp) return res.json({ formats: [], sourceFormat: null, fileSize: null });

    const ext = fp.split('.').pop().toLowerCase();
    const { EBOOK_CONVERT_FORMATS, COMIC_CONVERT_FORMATS } = await import('../services/calibreConvertService.js');
    const { default: pathMod } = await import('path');
    const { default: fsMod }   = await import('fs');
    const { fileURLToPath: ftu } = await import('url');
    const __d = pathMod.dirname(ftu(import.meta.url));
    const srcPath = pathMod.join(__d, '../../uploads', fp);

    let fileSize = null;
    try { fileSize = fsMod.statSync(srcPath).size; } catch {}

    let formats = [];
    let type = null;
    if (['epub', 'mobi', 'azw3', 'fb2'].includes(ext)) {
      type = 'ebook';
      formats = EBOOK_CONVERT_FORMATS.filter(f => f !== ext);
    } else if (['cbz', 'cbr'].includes(ext)) {
      type = 'comic';
      formats = COMIC_CONVERT_FORMATS;
    } else if (ext === 'pdf') {
      type = 'pdf';
      formats = [];
    }

    res.json({ formats, sourceFormat: ext, type, fileSize });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/requests/:id/convert?format=mobi — déclenche la conversion (timeout 3min)
router.post('/:id/convert', requireAuth, async (req, res) => {
  req.setTimeout(180000); // 3 minutes max pour la conversion
  try {
    const { format } = req.query;
    if (!format) return res.status(400).json({ error: 'Format cible requis (?format=...)' });

    const request = await BookRequest.findById(req.params.id).lean();
    if (!request) return res.status(404).json({ error: 'Demande introuvable' });
    if (!request.filePath) return res.status(400).json({ error: 'Fichier source indisponible' });

    const srcExt = request.filePath.split('.').pop().toLowerCase();
    const { default: path } = await import('path');
    const { default: fs } = await import('fs');
    const { fileURLToPath } = await import('url');
    const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
    const srcPath = path.join(__dirname2, '../../uploads', request.filePath);

    if (!fs.existsSync(srcPath)) return res.status(404).json({ error: 'Fichier source introuvable sur le serveur' });

    const targetFmt = format.toLowerCase();
    let convertedPath;

    if (['cbz', 'cbr'].includes(srcExt) && targetFmt === 'pdf') {
      // CBZ → PDF en Node.js pur
      const { cbzToPdf } = await import('../services/cbzToPdfService.js');
      convertedPath = await cbzToPdf(srcPath, request.title);
    } else {
      // Ebook → autre format via Calibre-Web
      const { convertViaCalibреWeb } = await import('../services/calibreConvertService.js');
      convertedPath = await convertViaCalibреWeb(srcPath, srcExt, targetFmt, request.title);
    }

    // Envoyer le fichier
    const filename = `${request.title.replace(/[^a-z0-9 .-]/gi, '_')}.${targetFmt}`;
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    const fileStream = fs.createReadStream(convertedPath);
    fileStream.pipe(res);
    fileStream.on('error', () => res.status(500).end());

  } catch (err) {
    console.error('[convert]', err.message);
    const status = err.message.includes('Calibre-Web') ? 503 : 500;
    res.status(status).json({ error: err.message });
  }
});

export default router;