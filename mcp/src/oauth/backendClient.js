import axios from 'axios';

const BASE_URL = (process.env.EBOOKREQUEST_URL || '').replace(/\/$/, '');
const INTERNAL_SECRET = process.env.MCP_INTERNAL_SERVICE_SECRET;

// Petit cache mémoire (par process) de l'opdsToken résolu pour un userId —
// un même access token OAuth sert potentiellement plusieurs appels d'outil
// MCP en quelques secondes pour un même tour de conversation ; évite de
// refaire l'aller-retour interne à chaque appel sans introduire de
// dépendance de synchronisation entre replicas (TTL court, cohérence
// éventuelle acceptable ici — au pire un appel de plus avant rafraîchissement
// si l'utilisateur vient de régénérer son opdsToken).
const CACHE_TTL_MS = 30 * 1000;
const cache = new Map(); // userId -> { opdsToken, expiresAt }

export async function resolveOpdsToken(userId) {
  const cached = cache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.opdsToken;

  if (!BASE_URL) throw new Error('EBOOKREQUEST_URL est requis.');
  if (!INTERNAL_SECRET) throw new Error('MCP_INTERNAL_SERVICE_SECRET est requis.');

  const res = await axios.get(`${BASE_URL}/api/internal/mcp/users/${userId}/opds-token`, {
    headers: { 'X-Internal-Service-Secret': INTERNAL_SECRET },
    timeout: 8000,
  });
  const opdsToken = res.data.opdsToken;
  cache.set(userId, { opdsToken, expiresAt: Date.now() + CACHE_TTL_MS });
  return opdsToken;
}

export function invalidateOpdsTokenCache(userId) {
  cache.delete(userId);
}
