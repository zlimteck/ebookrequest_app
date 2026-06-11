import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

// Vérification du token JWT ou opdsToken (pour MCP)
export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant.' });
  }
  const token = authHeader.split(' ')[1];

  // Essai JWT d'abord
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    return next();
  } catch {}

  // Fallback : opdsToken (utilisé par le serveur MCP)
  try {
    const user = await User.findOne({ opdsToken: token }).select('_id username role').lean();
    if (user) {
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