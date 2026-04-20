import express from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

const GITHUB_REPO = 'zlimteck/ebookrequest_app';
const CACHE_TTL = 60 * 60 * 1000; // 1h

let cache = { data: null, fetchedAt: 0 };

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

export default router;