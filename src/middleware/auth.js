import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Session from '../models/Session.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

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

  // ── Fallback : opdsToken (MCP / OPDS API clients) ─────────────────────────
  try {
    const user = await User.findOne({ opdsToken: token }).select('_id username role isActive').lean();
    if (user && user.isActive !== false) {
      req.user = { id: user._id.toString(), username: user.username, role: user.role };
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
