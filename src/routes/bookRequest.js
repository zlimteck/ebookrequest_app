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

export default router;