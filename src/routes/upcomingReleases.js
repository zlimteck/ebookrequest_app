import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import UpcomingRelease from '../models/UpcomingRelease.js';
import { getUpcomingReleasesConfig } from '../services/upcomingReleasesService.js';

const router = express.Router();
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SOURCES = ['bnf', 'hardcover'];
const SORT_FIELDS = { date: 'releaseDate', title: 'title' };

// GET /api/upcoming-releases/config — accessible à tout utilisateur connecté,
// pour masquer le lien de nav côté frontend quand la fonctionnalité est
// désactivée par l'administrateur.
router.get('/config', requireAuth, async (req, res) => {
  try {
    const config = await getUpcomingReleasesConfig();
    res.json(config);
  } catch (err) {
    res.status(500).json({ enabled: false });
  }
});

// GET /api/upcoming-releases?search=&source=&sort=&page=&limit= — liste
// globale des prochaines sorties (issue #52), pas liée au suivi d'auteurs ni
// à un utilisateur en particulier. Désactiver la fonctionnalité arrête
// seulement le rafraîchissement en tâche de fond (voir
// upcomingReleasesCron.js) — la lecture du cache déjà constitué reste
// autorisée, même convention que authorFollow (lecture jamais bloquée).
router.get('/', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const search = (req.query.search || '').trim();
    const source = SOURCES.includes(req.query.source) ? req.query.source : null;
    const sortField = SORT_FIELDS[req.query.sort] || SORT_FIELDS.date;
    const sortDir = req.query.dir === 'desc' ? -1 : 1;
    const sort = { [sortField]: sortDir };

    const searchFilter = {};
    if (search) {
      const regex = new RegExp(escRe(search), 'i');
      searchFilter.$or = [{ title: regex }, { author: regex }];
    }
    const filter = source ? { ...searchFilter, source } : searchFilter;

    const [items, total, sourceCountsAgg] = await Promise.all([
      UpcomingRelease.find(filter)
        .sort(sort)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      UpcomingRelease.countDocuments(filter),
      // Comptes par source pour les pastilles de filtre — toujours calculés
      // sur la recherche texte seule (pas le filtre source), pour que les
      // compteurs restent stables quand on change de pastille active.
      UpcomingRelease.aggregate([
        { $match: searchFilter },
        { $group: { _id: '$source', count: { $sum: 1 } } },
      ]),
    ]);

    const sourceCounts = { all: 0, bnf: 0, hardcover: 0 };
    for (const { _id, count } of sourceCountsAgg) {
      sourceCounts[_id] = count;
      sourceCounts.all += count;
    }

    res.json({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)), sourceCounts });
  } catch (err) {
    console.error('Erreur liste prochaines sorties:', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

export default router;
