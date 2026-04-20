import mongoose from 'mongoose';
import Notification from '../models/Notification.js';

// Marque une notification comme vue dans la base de données
const markNotificationAsSeen = async (requestId, notificationType = 'completed') => {
  try {
    const update = {};
    update[`notifications.${notificationType}.seen`] = true;
    update[`notifications.${notificationType}.seenAt`] = new Date();

    const updatedRequest = await mongoose.model('BookRequest').findByIdAndUpdate(
      requestId,
      { $set: update },
      { new: true }
    );

    return updatedRequest;
  } catch (error) {
    console.error('Erreur lors du marquage de la notification comme vue:', error);
    throw error;
  }
};

// Récupère toutes les notifications non vues pour un utilisateur (tous types)
const getUnseenNotifications = async (userId) => {
  try {
    const BookRequest = mongoose.model('BookRequest');

    const [completedRequests, canceledRequests, commentRequests] = await Promise.all([
      BookRequest.find({
        user: userId,
        status: 'completed',
        'notifications.completed.seen': { $ne: true }
      }),
      BookRequest.find({
        user: userId,
        status: 'canceled',
        'notifications.canceled.seen': { $ne: true }
      }),
      BookRequest.find({
        user: userId,
        adminComment: { $exists: true, $ne: '' },
        'notifications.adminComment.seen': { $ne: true }
      })
    ]);

    const standaloneNotifs = await Notification.find({
      user: userId,
      seen: { $ne: true },
      type: { $ne: 'new_request' } // géré séparément via /admin/unseen
    });

    const notifications = [
      ...completedRequests.map(r => ({ type: 'completed', request: r })),
      ...canceledRequests.map(r => ({ type: 'canceled', request: r })),
      ...commentRequests.map(r => ({ type: 'adminComment', request: r })),
      ...standaloneNotifs.map(n => ({ type: n.type, standalone: true, notification: n })),
    ];

    return notifications;
  } catch (error) {
    console.error('Erreur lors de la récupération des notifications non vues:', error);
    throw error;
  }
};

export { markNotificationAsSeen, getUnseenNotifications };
