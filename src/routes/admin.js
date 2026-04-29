import express from 'express';
import { getAdminStats } from '../controllers/adminController.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import BookRequest from '../models/BookRequest.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
router.use(requireAuth);
router.use(requireAdmin);
router.get('/stats', getAdminStats);

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

export default router;