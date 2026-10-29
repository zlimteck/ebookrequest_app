import express from 'express';
import crypto from 'crypto';
import User from '../models/User.js';

// Route interne, jamais destinée à un client final : le serveur MCP
// (service séparé, feat/mcp-oauth) s'en sert pour résoudre l'opdsToken d'un
// utilisateur à partir du seul userId contenu dans un access token OAuth
// qu'il a émis — jamais de requireAuth ici (le MCP n'a ni cookie ni session),
// protégée par un secret partagé comparé en temps constant à la place.
// N'est utile qu'avec MCP_INTERNAL_SERVICE_SECRET configuré des deux côtés ;
// répond 503 sinon plutôt que de désactiver silencieusement la vérification.
const router = express.Router();

const INTERNAL_SECRET = process.env.MCP_INTERNAL_SERVICE_SECRET;

function timingSafeEqualStrings(a, b) {
  const bufA = Buffer.from(a || '', 'utf8');
  const bufB = Buffer.from(b || '', 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireInternalService(req, res, next) {
  if (!INTERNAL_SECRET) {
    return res.status(503).json({ error: 'Service interne non configuré.' });
  }
  const provided = req.headers['x-internal-service-secret'] || '';
  if (!timingSafeEqualStrings(provided, INTERNAL_SECRET)) {
    return res.status(401).json({ error: 'Secret interne invalide.' });
  }
  next();
}

router.use(requireInternalService);

// GET /api/internal/mcp/users/:id/opds-token — renvoie (en le générant si
// besoin, même logique que GET /api/users/opds-token) l'opdsToken courant
// de l'utilisateur. Si l'utilisateur régénère son opdsToken depuis ses
// paramètres, les access tokens OAuth déjà émis continuent de fonctionner
// (ils ne contiennent jamais l'opdsToken lui-même, juste l'userId) et
// récupèrent automatiquement la nouvelle valeur à la prochaine vérification.
router.get('/users/:id/opds-token', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('opdsToken isActive');
    if (!user || user.isActive === false) {
      return res.status(404).json({ error: 'Utilisateur introuvable ou désactivé.' });
    }
    if (!user.opdsToken) {
      user.opdsToken = crypto.randomBytes(32).toString('hex');
      await user.save();
    }
    res.json({ opdsToken: user.opdsToken });
  } catch (error) {
    console.error('Erreur résolution opdsToken interne (MCP):', error.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

export default router;
