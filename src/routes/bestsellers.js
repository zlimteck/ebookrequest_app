import express from 'express';
import {
  getBestsellers,
  addBestseller,
  updateBestseller,
  deleteBestseller,
  reorderBestsellers,
  generateBestsellersWithAI
} from '../controllers/bestsellerController.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Routes admin seulement
router.get('/', requireAuth, requireAdmin, getBestsellers);
router.post('/', requireAuth, requireAdmin, addBestseller);
router.put('/:id', requireAuth, requireAdmin, updateBestseller);
router.delete('/:id', requireAuth, requireAdmin, deleteBestseller);
router.post('/reorder', requireAuth, requireAdmin, reorderBestsellers);
router.post('/generate', requireAuth, requireAdmin, generateBestsellersWithAI);

export default router;
