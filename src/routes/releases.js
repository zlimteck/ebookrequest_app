import express from 'express';
import { createRequire } from 'module';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const require       = createRequire(import.meta.url);
const { version: APP_VERSION } = require('../../package.json');

const router = express.Router();

const GITHUB_REPO = 'zlimteck/ebookrequest_app';

// Compare deux versions semver — retourne > 0 si b est plus récent que a
function semverGt(a, b) {
  const parse = v => v.replace(/^v/, '').split('-')[0].split('.').map(Number);
  const [aMaj = 0, aMin = 0, aPat = 0] = parse(a);
  const [bMaj = 0, bMin = 0, bPat = 0] = parse(b);
  if (bMaj !== aMaj) return bMaj - aMaj;
  if (bMin !== aMin) return bMin - aMin;
  return bPat - aPat;
}
const CACHE_TTL   = 60 * 60 * 1000; // 1h

let cache            = { data: null, fetchedAt: 0 };
let updateCache      = { data: null, fetchedAt: 0 };
const UPDATE_TTL     = 24 * 60 * 60 * 1000; // 24h

router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const now = Date.now();

    // Retourner le cache s'il est encore valide
    if (cache.data && now - cache.fetchedAt < CACHE_TTL) {
      return res.json(cache.data);
    }

    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases`,
      { headers: { 'User-Agent': 'ebookrequest-app', Accept: 'application/vnd.github+json' } }
    );

    if (!response.ok) {
      // En cas d'erreur GitHub, retourner le cache expiré s'il existe
      if (cache.data) return res.json(cache.data);
      return res.status(502).json({ error: 'Impossible de contacter GitHub.' });
    }

    const releases = await response.json();

    const payload = releases.map(r => ({
      id:          r.id,
      tag:         r.tag_name,
      name:        r.name || r.tag_name,
      body:        r.body || '',
      publishedAt: r.published_at,
      url:         r.html_url,
      prerelease:  r.prerelease,
    }));

    cache = { data: payload, fetchedAt: now };
    res.json(payload);
  } catch (err) {
    console.error('Erreur récupération releases:', err);
    if (cache.data) return res.json(cache.data);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// ── Vérification de mise à jour ──────────────────────────────────────────────
router.get('/update-check', requireAuth, requireAdmin, async (req, res) => {
  try {
    const now = Date.now();

    if (updateCache.data && now - updateCache.fetchedAt < UPDATE_TTL) {
      return res.json(updateCache.data);
    }

    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      { headers: { 'User-Agent': 'ebookrequest-app', Accept: 'application/vnd.github+json' } }
    );

    if (!response.ok) {
      if (updateCache.data) return res.json(updateCache.data);
      return res.status(502).json({ error: 'Impossible de contacter GitHub.' });
    }

    const release    = await response.json();
    const latestTag  = release.tag_name?.replace(/^v/, '') || '';
    const current    = APP_VERSION.replace(/^v/, '');

    const payload = {
      currentVersion:  current,
      latestVersion:   latestTag,
      updateAvailable: latestTag ? semverGt(current, latestTag) > 0 : false,
      releaseUrl:      release.html_url,
      releaseName:     release.name || release.tag_name,
    };

    updateCache = { data: payload, fetchedAt: now };
    res.json(payload);
  } catch (err) {
    console.error('Erreur update-check:', err);
    if (updateCache.data) return res.json(updateCache.data);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

export default router;