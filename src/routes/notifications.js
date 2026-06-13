import express from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { markNotificationAsSeen, getUnseenNotifications } from '../controllers/notificationController.js';
import BookRequest from '../models/BookRequest.js';
import Notification from '../models/Notification.js';

const HISTORY_DAYS = 7;

const router = express.Router();

// Historique des notifications (vues + non vues, 7 derniers jours)
router.get('/history', requireAuth, async (req, res) => {
  try {
    const userId  = req.user.id;
    const since   = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000);

    const [completed, canceled, comments, standalone] = await Promise.all([
      BookRequest.find({ user: userId, status: 'completed', updatedAt: { $gte: since } })
        .select('title author notifications updatedAt').sort({ updatedAt: -1 }).limit(30),
      BookRequest.find({ user: userId, status: 'canceled', updatedAt: { $gte: since } })
        .select('title author notifications cancelReason updatedAt').sort({ updatedAt: -1 }).limit(30),
      BookRequest.find({
        user: userId,
        updatedAt: { $gte: since },
        $or: [
          { adminComment: { $exists: true, $ne: '' } },
          { comments: { $elemMatch: { role: 'admin' } } },
        ],
      }).select('title author adminComment comments notifications updatedAt').sort({ updatedAt: -1 }).limit(30),
      Notification.find({ user: userId, type: { $ne: 'new_request' }, createdAt: { $gte: since } })
        .sort({ createdAt: -1 }).limit(30),
    ]);

    const items = [
      ...completed.map(r => ({
        type: 'completed', request: r,
        seen: r.notifications?.completed?.seen ?? false,
        date: r.notifications?.completed?.seenAt || r.updatedAt,
      })),
      ...canceled.map(r => ({
        type: 'canceled', request: r,
        seen: r.notifications?.canceled?.seen ?? false,
        date: r.notifications?.canceled?.seenAt || r.updatedAt,
      })),
      ...comments.map(r => ({
        type: 'adminComment', request: r,
        seen: r.notifications?.adminComment?.seen ?? false,
        date: r.notifications?.adminComment?.seenAt || r.updatedAt,
      })),
      ...standalone.map(n => ({
        type: n.type, standalone: true, notification: n,
        seen: n.seen ?? false,
        date: n.seenAt || n.createdAt,
      })),
    ];

    // Non lues en premier, puis par date décroissante
    items.sort((a, b) => {
      if (a.seen !== b.seen) return a.seen ? 1 : -1;
      return new Date(b.date) - new Date(a.date);
    });

    res.json({ success: true, notifications: items });
  } catch (error) {
    console.error('Erreur historique notifications:', error);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Marquer une notification comme vue
router.post('/:requestId/seen', requireAuth, async (req, res) => {
  try {
    const { requestId } = req.params;
    const { type = 'completed' } = req.body;
    
    const updatedRequest = await markNotificationAsSeen(requestId, type);
    
    if (!updatedRequest) {
      return res.status(404).json({ error: 'Demande non trouvée' });
    }
    
    res.json({ success: true, request: updatedRequest });
  } catch (error) {
    console.error('Erreur lors du marquage de la notification comme vue:', error);
    res.status(500).json({ error: 'Erreur lors du marquage de la notification comme vue' });
  }
});

// Récupérer les notifications non vues pour l'utilisateur connecté
router.get('/unseen', requireAuth, async (req, res) => {
  try {
    const notifications = await getUnseenNotifications(req.user.id);
    res.json({ success: true, notifications });
  } catch (error) {
    console.error('Erreur lors de la récupération des notifications non vues:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des notifications' });
  }
});

// Marquer une notification standalone comme vue
router.post('/standalone/:id/seen', requireAuth, async (req, res) => {
  try {
    const notif = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user.id },
      { seen: true, seenAt: new Date() }
    );
    if (!notif) return res.status(404).json({ error: 'Notification non trouvée' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors du marquage' });
  }
});

// Notifications admin : signalements non vus + nouvelles demandes
router.get('/admin/unseen', requireAuth, requireAdmin, async (req, res) => {
  try {
    const [reportedRequests, newRequestNotifs, userCommentRequests] = await Promise.all([
      BookRequest.find({ status: 'reported', reportSeenByAdmin: { $ne: true } }),
      Notification.find({ user: req.user.id, type: 'new_request', seen: false }),
      BookRequest.find({
        'notifications.userComment.seen': { $ne: true },
        comments: { $elemMatch: { role: 'user', seenByAdmin: false } },
      }).select('title author username comments notifications'),
    ]);

    const notifications = [
      ...reportedRequests.map(r => ({ type: 'reported', request: r })),
      ...newRequestNotifs.map(n => ({ type: 'new_request', standalone: true, notification: n })),
      ...userCommentRequests.map(r => ({ type: 'userComment', request: r })),
    ];

    res.json({ success: true, notifications });
  } catch (error) {
    console.error('Erreur lors de la récupération des notifications admin:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des notifications' });
  }
});

// Marquer un signalement comme vu par l'admin
router.post('/admin/:requestId/seen', requireAuth, requireAdmin, async (req, res) => {
  try {
    await BookRequest.findByIdAndUpdate(req.params.requestId, { reportSeenByAdmin: true });
    res.json({ success: true });
  } catch (error) {
    console.error('Erreur lors du marquage du signalement:', error);
    res.status(500).json({ error: 'Erreur lors du marquage du signalement' });
  }
});

export default router;