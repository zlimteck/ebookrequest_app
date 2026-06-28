import User from '../models/User.js';
import Session from '../models/Session.js';

const DEBOUNCE_MS = 5 * 60 * 1000; // mise à jour max 1x toutes les 5 min

const updateLastActivity = async (req, res, next) => {
  next(); // ne pas bloquer la requête

  if (!req.user) return;

  const now = new Date();

  try {
    // User.lastActivity — toujours mis à jour (existant)
    User.findByIdAndUpdate(req.user.id, { lastActivity: now }).catch(() => {});

    // Session.lastActivity — avec debounce pour limiter les écritures
    if (req.sessionId && req.sessionLastActivity) {
      const elapsed = now - new Date(req.sessionLastActivity);
      if (elapsed > DEBOUNCE_MS) {
        Session.findByIdAndUpdate(req.sessionId, { lastActivity: now }).catch(() => {});
      }
    }
  } catch {}
};

export default updateLastActivity;
