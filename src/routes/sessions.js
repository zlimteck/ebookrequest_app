import express from 'express';
import mongoose from 'mongoose';
import geoip from 'geoip-lite';
import { requireAuth } from '../middleware/auth.js';
import Session from '../models/Session.js';
import { decrypt } from '../services/cryptoService.js';

const router = express.Router();

// Minimal UA parser — avoids adding a dependency
function parseUserAgent(ua) {
  if (!ua) return { browser: 'Inconnu', os: 'Inconnu' };

  let browser = 'Inconnu';
  let os = 'Inconnu';

  // Browser detection (order matters — Chrome must come before Safari)
  if (/Edg\//.test(ua))          browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/Firefox\//.test(ua))  browser = 'Firefox';
  else if (/Chrome\//.test(ua))   browser = 'Chrome';
  else if (/Safari\//.test(ua))   browser = 'Safari';
  else if (/MSIE|Trident/.test(ua)) browser = 'Internet Explorer';

  // OS detection
  if (/Windows/.test(ua))         os = 'Windows';
  else if (/iPhone|iPad/.test(ua)) os = 'iOS';
  else if (/Mac OS X/.test(ua))   os = 'macOS';
  else if (/Android/.test(ua))    os = 'Android';
  else if (/Linux/.test(ua))      os = 'Linux';

  return { browser, os };
}

// GET /api/sessions — list active sessions for current user
router.get('/', requireAuth, async (req, res) => {
  try {
    const sessions = await Session.find({
      userId: req.user.id,
      expiresAt: { $gt: new Date() },
    }).sort({ lastActivity: -1 }).lean();

    const result = sessions.map(s => {
      const { browser, os } = parseUserAgent(decrypt(s.userAgent) || s.userAgent);
      const ip = decrypt(s.ip) || s.ip;
      const geo = ip ? geoip.lookup(ip) : null;
      const location = geo
        ? [geo.city, geo.country].filter(Boolean).join(', ')
        : null;
      return {
        id: s._id,
        ip,
        location,
        browser,
        os,
        loginMethod: s.loginMethod,
        lastActivity: s.lastActivity,
        createdAt: s.createdAt,
        isCurrent: s._id.toString() === req.sessionId,
      };
    });

    res.json(result);
  } catch (err) {
    console.error('GET /sessions:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// DELETE /api/sessions/:id — revoke a specific session (not the current one)
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Session invalide.' });
    }

    if (id === req.sessionId) {
      return res.status(400).json({ error: 'Impossible de révoquer la session courante depuis cet endpoint. Utilisez /api/auth/logout.' });
    }

    const result = await Session.deleteOne({ _id: id, userId: req.user.id });
    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Session non trouvée.' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /sessions/:id:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// DELETE /api/sessions — revoke all sessions except the current one
router.delete('/', requireAuth, async (req, res) => {
  try {
    const result = await Session.deleteMany({
      userId: req.user.id,
      _id: { $ne: req.sessionId },
    });

    res.json({ success: true, revoked: result.deletedCount });
  } catch (err) {
    console.error('DELETE /sessions:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

export default router;
