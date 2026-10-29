// Enveloppe maison autour de la vérification OAuth : requireBearerAuth() du
// SDK rejette tout de suite un token qui n'est pas un JWT valide, sans
// retomber sur l'ancien chemin opdsToken statique utilisé par OpenWebUI/
// ChatMCP/Claude Desktop — on ne peut donc pas l'utiliser tel quel ici.
//
// Un JWT a toujours exactement 3 segments séparés par des points ; un
// opdsToken (hex 64 caractères ou UUID selon l'origine, voir User.js /
// passkey.js côté backend) n'en a jamais 3 au format attendu par jwt.verify.
// Sur cette seule base, on choisit le chemin de vérification — jamais de
// cumul des deux.
function buildWwwAuthHeader(resourceMetadataUrl, message) {
  let header = `Bearer error="invalid_token", error_description="${message}"`;
  if (resourceMetadataUrl) header += `, resource_metadata="${resourceMetadataUrl}"`;
  return header;
}

function send401(res, resourceMetadataUrl, message) {
  res.set('WWW-Authenticate', buildWwwAuthHeader(resourceMetadataUrl, message));
  res.status(401).json({ error: 'invalid_token', error_description: message });
}

export function flexibleBearerAuth({ provider, resourceMetadataUrl, staticFallbackToken }) {
  return async (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const [type, headerToken] = authHeader.split(' ');
    // Pas de header du tout : repli sur EBOOKREQUEST_TOKEN (configuration
    // historique à l'échelle du serveur, un seul token pour tous les
    // clients) — comportement identique à avant l'introduction de l'OAuth.
    const token = (type?.toLowerCase() === 'bearer' && headerToken) ? headerToken : staticFallbackToken;
    if (!token) {
      return send401(res, resourceMetadataUrl, "Missing or malformed Authorization header, expected 'Bearer TOKEN'");
    }

    const looksLikeJwt = token.split('.').length === 3;
    if (looksLikeJwt) {
      try {
        const authInfo = await provider.verifyAccessToken(token);
        if (typeof authInfo.expiresAt !== 'number' || authInfo.expiresAt < Date.now() / 1000) {
          throw new Error('expired');
        }
        req.auth = authInfo;
        return next();
      } catch {
        return send401(res, resourceMetadataUrl, 'Invalid or expired access token');
      }
    }

    // Ancien chemin : le token statique (opdsToken) n'est jamais validé ici,
    // exactement comme avant cette fonctionnalité — c'est le backend
    // principal qui le revalide à chaque appel d'API déclenché par un outil
    // MCP. On ne casse donc rien pour les clients déjà configurés ainsi.
    req.auth = { token, legacyStaticToken: true };
    next();
  };
}
