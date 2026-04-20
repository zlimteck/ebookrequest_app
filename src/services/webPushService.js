import webpush from 'web-push';
import PushSubscription from '../models/PushSubscription.js';

// Configuration VAPID (optionnelle — pas de crash si les clés sont absentes)
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    `mailto:${process.env.SMTP_USER || 'admin@ebookrequest.fr'}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

/**
 * Envoie une notification push à tous les appareils d'un utilisateur
 * @param {string} userId
 * @param {object} payload  { title, body, url, icon }
 */
export const sendPushToUser = async (userId, payload) => {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return;

  let subscriptions;
  try {
    subscriptions = await PushSubscription.find({ user: userId });
  } catch (err) {
    console.error('Erreur récupération subscriptions push:', err);
    return;
  }

  if (!subscriptions.length) return;

  const notification = JSON.stringify({
    title: payload.title || 'EbookRequest',
    body:  payload.body  || '',
    url:   payload.url   || '/',
    icon:  payload.icon  || '/img/logo.png',
    badge: '/img/logo.png'
  });

  const results = await Promise.allSettled(
    subscriptions.map(sub =>
      webpush.sendNotification(sub.subscription, notification)
    )
  );

  // Supprimer les souscriptions expirées (410 Gone)
  const toDelete = [];
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      const status = result.reason?.statusCode;
      if (status === 410 || status === 404) {
        toDelete.push(subscriptions[i]._id);
      } else {
        console.error('Erreur envoi push:', result.reason?.message);
      }
    }
  });

  if (toDelete.length) {
    await PushSubscription.deleteMany({ _id: { $in: toDelete } });
  }
};