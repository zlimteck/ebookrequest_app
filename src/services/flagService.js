import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { sendPushToUser } from './webPushService.js';

// Déblocage d'un flag secret (mini-CTF, voir src/routes/flags.js et la vérification
// de phrase dans src/routes/chatbot.js). Sticky comme les autres succès, notifie via
// le même type 'achievement_unlocked' (déjà filtré "Trophées" côté app).
export async function unlockFlag(userId, slug, label) {
  const user = await User.findById(userId).select('unlockedFlags');
  if (user.unlockedFlags?.includes(slug)) return false;

  await User.updateOne({ _id: userId }, { $addToSet: { unlockedFlags: slug } });

  const message = `Flag secret trouvé : ${label}`;
  Notification.create({ user: userId, type: 'achievement_unlocked', title: 'Flag débloqué', message }).catch(() => {});
  sendPushToUser(userId, { title: 'Flag débloqué', body: message, url: '/profile' }).catch(() => {});
  return true;
}
