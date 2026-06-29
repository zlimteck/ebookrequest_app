import geoip from 'geoip-lite';
import Session from '../models/Session.js';
import User from '../models/User.js';
import { encrypt, decrypt } from '../services/cryptoService.js';
import { sendNewLoginAlertEmail } from '../services/emailService.js';

function parseUserAgent(ua) {
  if (!ua) return { browser: 'Inconnu', os: 'Inconnu' };
  let browser = 'Inconnu';
  let os = 'Inconnu';
  if (/Edg\//.test(ua))             browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua))  browser = 'Opera';
  else if (/Firefox\//.test(ua))    browser = 'Firefox';
  else if (/Chrome\//.test(ua))     browser = 'Chrome';
  else if (/Safari\//.test(ua))     browser = 'Safari';
  else if (/MSIE|Trident/.test(ua)) browser = 'Internet Explorer';
  if (/Windows/.test(ua))           os = 'Windows';
  else if (/iPhone|iPad/.test(ua))  os = 'iOS';
  else if (/Mac OS X/.test(ua))     os = 'macOS';
  else if (/Android/.test(ua))      os = 'Android';
  else if (/Linux/.test(ua))        os = 'Linux';
  return { browser, os };
}

async function checkAndSendLoginAlert(userId, newSessionId, { ip, userAgent, loginMethod }) {
  try {
    const user = await User.findById(userId)
      .select('email emailVerified notificationPreferences username').lean();
    if (!user?.email || !user?.emailVerified || !user?.notificationPreferences?.email?.enabled || user?.notificationPreferences?.email?.loginAlert === false) return;

    const newGeo = ip ? geoip.lookup(ip) : null;
    const newCountry = newGeo?.country || null;

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentSessions = await Session.find({
      userId,
      createdAt: { $gte: since },
      _id: { $ne: newSessionId },
    }).select('ip').lean();

    const isNewLocation = recentSessions.length === 0 || !recentSessions.some(s => {
      const decryptedIp = decrypt(s.ip) || s.ip;
      const geo = decryptedIp ? geoip.lookup(decryptedIp) : null;
      return geo?.country === newCountry;
    });

    if (!isNewLocation) return;

    const { browser, os } = parseUserAgent(userAgent);
    const location = newGeo ? [newGeo.city, newGeo.country].filter(Boolean).join(', ') : null;

    await sendNewLoginAlertEmail(user, { ip, location, browser, os, loginMethod });
  } catch {}
}

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

  checkAndSendLoginAlert(userId, session._id, { ip, userAgent, loginMethod }).catch(() => {});

  return session._id.toString();
}

export function getClientIP(req) {
  const raw =
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    '';
  return raw.replace(/^::ffff:/, '');
}
