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

  // App iOS (header custom, pas un vrai UA de navigateur) : "EbookRequest-iOS/1.0 (Version 26.0 (Build 23A5297g))"
  // browser/os affichés côte à côte ("{browser} · {os}") côté front — éviter
  // de répéter "iOS" des deux côtés.
  const iosAppMatch = ua.match(/^EbookRequest-iOS\/([\d.]+)/);
  if (iosAppMatch) {
    return { browser: 'EbookRequest', os: `iOS v${iosAppMatch[1]}` };
  }

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
      revokedAt: null,
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

    const session = await Session.findOne({ _id: id, userId: req.user.id });
    if (!session) {
      return res.status(404).json({ error: 'Session non trouvée.' });
    }

    // Sessions 'token' (app iOS/OPDS/MCP) : le document est gardé, marqué
    // révoqué — voir Session.revokedAt et le chemin token de auth.js, qui s'en
    // sert pour bloquer réellement l'accès de cet appareil précis. Les autres
    // types de session sont supprimés pour de bon : le JWT est vérifié via son
    // sid (auth.js), sa session ne peut donc jamais être "recréée" derrière.
    if (session.loginMethod === 'token') {
      session.revokedAt = new Date();
      await session.save();
    } else {
      await session.deleteOne();
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
    const filter = {
      userId: req.user.id,
      _id: { $ne: req.sessionId },
      revokedAt: null,
    };

    // Même logique que DELETE /:id : révocation douce pour les sessions
    // 'token', suppression pour les autres.
    const tokenResult = await Session.updateMany(
      { ...filter, loginMethod: 'token' },
      { $set: { revokedAt: new Date() } }
    );
    const deleteResult = await Session.deleteMany({ ...filter, loginMethod: { $ne: 'token' } });

    res.json({ success: true, revoked: tokenResult.modifiedCount + deleteResult.deletedCount });
  } catch (err) {
    console.error('DELETE /sessions:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

export default router;
