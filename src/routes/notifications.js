import express from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { markNotificationAsSeen, getUnseenNotifications } from '../controllers/notificationController.js';
import BookRequest from '../models/BookRequest.js';
import Notification from '../models/Notification.js';

const router = express.Router();

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
    const [reportedRequests, newRequestNotifs] = await Promise.all([
      BookRequest.find({ status: 'reported', reportSeenByAdmin: { $ne: true } }),
      Notification.find({ user: req.user.id, type: 'new_request', seen: false })
    ]);

    const notifications = [
      ...reportedRequests.map(r => ({ type: 'reported', request: r })),
      ...newRequestNotifs.map(n => ({ type: 'new_request', standalone: true, notification: n }))
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