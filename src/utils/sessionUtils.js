import Session from '../models/Session.js';
import { encrypt } from '../services/cryptoService.js';

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours
const MAX_SESSIONS_PER_USER = 10;

export async function createSession(userId, { ip = '', userAgent = '', loginMethod = 'password' } = {}) {
  // Supprimer les sessions excédentaires (garder les plus récentes)
  const activeSessions = await Session.find(
    { userId, expiresAt: { $gt: new Date() } },
    '_id createdAt'
  ).sort({ createdAt: 1 }).lean();

  if (activeSessions.length >= MAX_SESSIONS_PER_USER) {
    const toDelete = activeSessions.slice(0, activeSessions.length - MAX_SESSIONS_PER_USER + 1);
    await Session.deleteMany({ _id: { $in: toDelete.map(s => s._id) } });
  }

  const session = await Session.create({
    userId,
    ip: encrypt(ip) || ip,
    userAgent: encrypt(userAgent) || userAgent,
    loginMethod,
    expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
  });

  return session._id.toString();
}

export function getClientIP(req) {
  const raw =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    '';
  return raw.replace(/^::ffff:/, '');
}
