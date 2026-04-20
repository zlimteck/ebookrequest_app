import express from 'express';
import { getAdminStats } from '../controllers/adminController.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = express.Router();
router.use(requireAuth);
router.use(requireAdmin);
router.get('/stats', getAdminStats);

export default router;