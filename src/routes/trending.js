import express from 'express';
import { getTrendingBooksController } from '../controllers/trendingController.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Route pour récupérer les livres tendance (nécessite authentification)
router.get('/monthly', requireAuth, getTrendingBooksController);

export default router;