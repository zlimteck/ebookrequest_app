import express from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import OpdsLog from '../models/OpdsLog.js';
import User from '../models/User.js';

const router = express.Router();

// GET /api/admin/opds/stats — usage stats per user
router.get('/stats', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Aggregate: last access, catalog count, download count per user
    const stats = await OpdsLog.aggregate([
      {
        $group: {
          _id: '$user',
          lastAccess: { $max: '$accessedAt' },
          catalogCount: { $sum: { $cond: [{ $eq: ['$action', 'catalog'] }, 1, 0] } },
          downloadCount: { $sum: { $cond: [{ $eq: ['$action', 'download'] }, 1, 0] } },
          clients: { $addToSet: '$client' },
        }
      },
      { $sort: { lastAccess: -1 } }
    ]);

    // Populate usernames
    const userIds = stats.map(s => s._id);
    const users = await User.find({ _id: { $in: userIds } }).select('username');
    const userMap = Object.fromEntries(users.map(u => [u._id.toString(), u.username]));

    const result = stats.map(s => ({
      userId: s._id,
      username: userMap[s._id.toString()] || 'Inconnu',
      lastAccess: s.lastAccess,
      catalogCount: s.catalogCount,
      downloadCount: s.downloadCount,
      clients: s.clients.filter(Boolean),
    }));

    res.json({ success: true, stats: result });
  } catch (err) {
    console.error('Erreur OPDS stats:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/admin/opds/logs — recent logs
router.get('/logs', requireAuth, requireAdmin, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const logs = await OpdsLog.find()
      .populate('user', 'username')
      .sort({ accessedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);
    const total = await OpdsLog.countDocuments();
    res.json({ success: true, logs, total, page, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;