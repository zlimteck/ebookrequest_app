import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import User from '../models/User.js';
import Session from '../models/Session.js';
import { encrypt } from '../services/cryptoService.js';
import { getClientIP } from '../utils/sessionUtils.js';

const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours, comme createSession()

// Vérification du token JWT ou opdsToken (pour MCP)
export async function requireAuth(req, res, next) {
  // Cookie (navigateur) → Authorization header (MCP / OPDS API clients)
  const cookieToken = req.cookies?.token;
  const authHeader = req.headers.authorization;
  const token = cookieToken || (authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null);

  if (!token) return res.status(401).json({ error: 'Token manquant.' });

  // ── JWT path ──────────────────────────────────────────────────────────────
  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Les JWTs sans claim `sid` (tokens antérieurs aux sessions) sont rejetés
    if (!decoded.sid) {
      return res.status(401).json({ error: 'Session expirée, veuillez vous reconnecter.' });
    }

    const session = await Session.findOne({
      _id: decoded.sid,
      userId: decoded.id,
      expiresAt: { $gt: new Date() },
    }).lean();

    if (!session) {
      return res.status(401).json({ error: 'Session expirée ou révoquée.' });
    }

    const user = await User.findById(decoded.id).select('isActive role').lean();
    if (!user || user.isActive === false) {
      return res.status(401).json({ error: 'Compte désactivé ou introuvable.' });
    }

    req.user = { ...decoded, role: user.role };
    req.sessionId = decoded.sid;
    req.sessionLastActivity = session.lastActivity;
    return next();
  } catch {}

  // ── Fallback : opdsToken (app iOS / OPDS / MCP) ───────────────────────────
  try {
    const user = await User.findOne({ opdsToken: token }).select('_id username role isActive').lean();
    if (user && user.isActive !== false) {
      // Une session par appareil (userId + user-agent), retrouvée/rafraîchie à
      // chaque requête plutôt que recréée — ce chemin est emprunté à chaque
      // appel API (potentiellement des centaines par session d'usage), une
      // session par requête inonderait la collection.
      const userAgent = req.headers['user-agent'] || '';
      const deviceKey = crypto.createHash('sha256').update(`${user._id}:${userAgent}`).digest('hex');

      let session = await Session.findOne({ userId: user._id, loginMethod: 'token', deviceKey });

      // Révoquée depuis "Sessions actives" : le document est gardé (voir
      // Session.revokedAt) au lieu d'être supprimé, précisément pour pouvoir
      // bloquer ici l'accès de cet appareil sans toucher à l'opdsToken lui-même
      // (qui reste valide pour les autres appareils/clients l'utilisant).
      if (session?.revokedAt) {
        return res.status(401).json({ error: 'Accès révoqué pour cet appareil.' });
      }

      if (!session) {
        session = await Session.create({
          userId: user._id,
          loginMethod: 'token',
          deviceKey,
          ip: encrypt(getClientIP(req)) || '',
          userAgent: encrypt(userAgent) || '',
          lastActivity: new Date(),
          expiresAt: new Date(Date.now() + TOKEN_SESSION_DURATION_MS),
        });
      }

      req.user = { id: user._id.toString(), username: user.username, role: user.role };
      req.sessionId = session._id.toString();
      req.sessionLastActivity = session.lastActivity;
      return next();
    }
  } catch {}

  return res.status(401).json({ error: 'Token invalide.' });
}

// Vérification du rôle
export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
  }
  next();
}
