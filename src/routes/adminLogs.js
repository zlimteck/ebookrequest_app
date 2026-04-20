import express from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import AdminLog from '../models/AdminLog.js';

const router = express.Router();

// Récupérer les logs d'activité (50 derniers)
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const logs = await AdminLog.find()
      .sort({ createdAt: -1 })
      .limit(limit);
    res.json({ success: true, logs });
  } catch (error) {
    console.error('Erreur lors de la récupération des logs:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des logs' });
  }
});

export default router;