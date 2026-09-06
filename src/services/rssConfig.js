import ConnectorSettings from '../models/ConnectorSettings.js';

const DEFAULT_RSS_URL = 'https://predb.me/?cats=books-ebooks&rss=1';
const CACHE_TTL_MS = 60 * 1000;
let cache = { value: undefined, expiresAt: 0 };

export function invalidateRSSUrlCache() {
  cache = { value: undefined, expiresAt: 0 };
}

/**
 * (patch) : jusqu'ici, retournait TOUJOURS une URL exploitable (repli sur
 * predb.me par défaut), que `enabled` soit true ou false — le toggle admin
 * ne changeait donc jamais si la vérification avait lieu, seulement si une
 * URL personnalisée était utilisée. Confirmé en pratique : logs montrant
 * l'appel partir malgré le toggle désactivé.
 * Retourne maintenant `null` si désactivé — plus aucun appel HTTP ne doit
 * être fait dans ce cas (voir fetchRSSFeed).
 */
export async function getRSSFeedUrl() {
  if (cache.expiresAt > Date.now()) return cache.value;

  let url = null;
  try {
    const doc = await ConnectorSettings.findOne({ service: 'rss' }).lean();
    if (doc?.enabled) {
      url = doc.url || process.env.RSS_FEED_URL || DEFAULT_RSS_URL;
    }
  } catch {
    // MongoDB indisponible → on ne suppose pas que c'est activé
  }

  cache = { value: url, expiresAt: Date.now() + CACHE_TTL_MS };
  return url;
}
