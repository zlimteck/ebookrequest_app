import express from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import EmailLog from '../models/EmailLog.js';

const router = express.Router();

// GET /api/admin/email-logs
// Query params: page, limit, status, type, search
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, parseInt(req.query.limit) || 50);
    const skip   = (page - 1) * limit;

    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.type)   filter.type   = req.query.type;
    if (req.query.search) {
      filter.$or = [
        { to:      { $regex: req.query.search, $options: 'i' } },
        { subject: { $regex: req.query.search, $options: 'i' } },
      ];
    }

    const [logs, total] = await Promise.all([
      EmailLog.find(filter)
        .sort({ sentAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      EmailLog.countDocuments(filter),
    ]);

    res.json({ logs, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('Erreur email-logs:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/admin/email-logs/stats
// Compteurs par statut + provider pour les 30 derniers jours
router.get('/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [byStatus, byType, byProvider] = await Promise.all([
      EmailLog.aggregate([
        { $match: { sentAt: { $gte: since } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      EmailLog.aggregate([
        { $match: { sentAt: { $gte: since } } },
        { $group: { _id: '$type', count: { $sum: 1 } } },
      ]),
      EmailLog.aggregate([
        { $match: { sentAt: { $gte: since } } },
        { $group: { _id: '$provider', count: { $sum: 1 } } },
      ]),
    ]);

    res.json({ byStatus, byType, byProvider });
  } catch (err) {
    console.error('Erreur email-logs/stats:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;