import express from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { searchAuthors, getAuthorDetails } from '../services/openLibraryAuthorService.js';
import {
  followAuthor, unfollowAuthor, updateFollow, listFollowedAuthors, getAuthorFollowConfig,
} from '../services/authorFollowService.js';
import BookRequest from '../models/BookRequest.js';
import Notification from '../models/Notification.js';
import AuthorFollow from '../models/AuthorFollow.js';
import Author from '../models/Author.js';
import { isAIConfigured } from '../services/aiProviderService.js';
import { getUserBookRequests, getUserLibraryBooks, generateAuthorSuggestions } from '../services/recommendationService.js';
import AuthorSuggestion from '../models/AuthorSuggestion.js';

const router = express.Router();
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// GET /api/authors/search?q=...
router.get('/search', requireAuth, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q?.trim()) return res.json({ authors: [] });
    const authors = await searchAuthors(q.trim());
    res.json({ authors });
  } catch (err) {
    console.error('Erreur recherche auteur:', err.message);
    res.status(500).json({ error: 'Erreur lors de la recherche.' });
  }
});

// POST /api/authors/check-duplicates — { author, titles: [...] } (page de 10
// maximum côté frontend). Une seule requête groupée plutôt qu'un appel
// check-duplicate par livre, qui pouvait à lui seul épuiser le quota du
// rate-limiter général de l'API (120 req/min) sur une seule page de résultats.
router.post('/check-duplicates', requireAuth, async (req, res) => {
  try {
    const { author, titles } = req.body;
    if (!author?.trim() || !Array.isArray(titles) || titles.length === 0) {
      return res.json({ duplicateTitles: [] });
    }
    const existingRequests = await BookRequest.find({
      author: { $regex: `^${escRe(author.trim())}$`, $options: 'i' },
      status: { $nin: ['canceled'] },
    }).select('title').lean();
    const existingTitles = new Set(existingRequests.map(r => r.title.trim().toLowerCase()));
    const duplicateTitles = titles.filter(t => existingTitles.has((t || '').trim().toLowerCase()));
    res.json({ duplicateTitles });
  } catch (err) {
    console.error('Erreur check-duplicates auteur:', err.message);
    res.json({ duplicateTitles: [] });
  }
});

// GET /api/authors/recent-releases — fil des dernières nouveautés détectées
// par authorReleaseCron.js pour l'utilisateur courant. Contrairement à
// l'email/push (jamais consultables après coup), ces détections sont aussi
// gardées en base (Notification) pour être affichées directement sur la
// page Auteurs suivis.
router.get('/recent-releases', requireAuth, async (req, res) => {
  try {
    const releases = await Notification.find({ user: req.user.id, type: 'new_author_release' })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();
    res.json({ releases });
  } catch (err) {
    console.error('Erreur fil nouveautés auteurs:', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// Calcule une liste fraîche de suggestions, deux sources combinées,
// dédupliquées :
// 1. Auteurs déjà présents dans les demandes de l'utilisateur mais pas
//    encore suivis (heuristique simple, bornée aux plus fréquents, jamais
//    régénérée par l'IA : ne dépend pas d'elle, aucune raison de changer
//    d'une régénération à l'autre).
// 2. Si un fournisseur IA est configuré par l'admin, des suggestions
//    d'auteurs générées par l'IA sur la même base de signal que les
//    recommandations de livres (demandes + bibliothèque notée) — jamais
//    les mêmes auteurs que la source 1 ou déjà suivis.
// Chaque nom candidat est résolu vers une clé Open Library stable, un seul
// appel Open Library par candidat.
async function computeAuthorSuggestions(userId) {
  const followedAuthorIds = (await AuthorFollow.find({ user: userId }).select('author')).map(f => f.author);
  const followedNames = new Set(
    (await Author.find({ _id: { $in: followedAuthorIds } }).select('name')).map(a => a.name.trim().toLowerCase())
  );

  const resolveCandidate = async (name) => {
    try {
      const matches = await searchAuthors(name, 1);
      const match = matches[0];
      if (!match) return null;
      // N'accepte que si le nom résolu correspond vraiment au candidat,
      // pas juste "le premier résultat trouvé" sur une recherche large.
      if (match.name.trim().toLowerCase() !== name.trim().toLowerCase()) return null;
      return match;
    } catch {
      return null;
    }
  };

  const topAuthors = await BookRequest.aggregate([
    { $match: { user: new mongoose.Types.ObjectId(userId), author: { $nin: ['', 'Auteur inconnu'] } } },
    { $group: { _id: '$author', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 8 },
  ]);
  const heuristicCandidates = topAuthors
    .map(a => a._id)
    .filter(name => name && !followedNames.has(name.trim().toLowerCase()))
    .slice(0, 5);
  const heuristicResolved = (await Promise.all(heuristicCandidates.map(resolveCandidate)))
    .filter(Boolean)
    .map(a => ({ ...a, reason: 'Déjà dans vos demandes' }));

  let aiResolved = [];
  if (await isAIConfigured()) {
    const [bookRequests, libraryBooks] = await Promise.all([
      getUserBookRequests(userId),
      getUserLibraryBooks(userId),
    ]);
    const alreadySuggested = [...followedNames, ...heuristicResolved.map(a => a.name.toLowerCase())];
    const aiSuggestions = await generateAuthorSuggestions(bookRequests, libraryBooks, [...followedNames, ...heuristicResolved.map(a => a.name)], 5);
    aiResolved = (await Promise.all(aiSuggestions.map(async (s) => {
      const match = await resolveCandidate(s.name);
      return match && !alreadySuggested.includes(match.name.toLowerCase()) ? { ...match, reason: s.reason || 'Suggéré par l\'IA' } : null;
    }))).filter(Boolean);
  }

  return [...heuristicResolved, ...aiResolved];
}

// GET /api/authors/suggestions — retourne le cache si disponible, génère la
// première fois seulement (pas de régénération manuelle).
router.get('/suggestions', requireAuth, async (req, res) => {
  try {
    const cached = await AuthorSuggestion.findOne({ user: req.user.id });
    if (cached && cached.suggestions.length > 0) {
      return res.json({ suggestions: cached.suggestions });
    }

    const suggestions = await computeAuthorSuggestions(req.user.id);
    await AuthorSuggestion.findOneAndUpdate(
      { user: req.user.id },
      { suggestions, generatedAt: new Date() },
      { upsert: true, new: true }
    );
    res.json({ suggestions });
  } catch (err) {
    console.error('Erreur suggestions auteurs:', err.message);
    res.json({ suggestions: [] });
  }
});

// GET /api/authors/:key — identité de l'auteur (nom, bio, photo) uniquement.
// La liste des livres ne vient plus d'ici (voir GET /api/books/search?author=,
// déjà utilisé par "Nouvelle demande" : même repli Google Books → Hardcover →
// Open Library, déjà paginé et mis en cache côté serveur, pas besoin de
// réinventer un système dédié qui aurait chargé toute la bibliographie d'un
// coup et renvoyé des titres bruts Open Library non corrigés).
router.get('/:key', requireAuth, async (req, res) => {
  try {
    const details = await getAuthorDetails(req.params.key);
    res.json({ author: details });
  } catch (err) {
    console.error('Erreur détails auteur:', err.message);
    res.status(404).json({ error: 'Auteur introuvable.' });
  }
});

// GET /api/authors/me/followed
router.get('/me/followed', requireAuth, async (req, res) => {
  try {
    const authors = await listFollowedAuthors(req.user.id);
    const config = await getAuthorFollowConfig();
    res.json({ authors, config });
  } catch (err) {
    console.error('Erreur liste auteurs suivis:', err.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/authors/:key/follow
router.post('/:key/follow', requireAuth, async (req, res) => {
  try {
    const { autoRequest } = req.body;
    const { author } = await followAuthor(req.user.id, req.params.key, autoRequest);
    res.json({ success: true, author: { openLibraryKey: author.openLibraryKey, name: author.name, photoUrl: author.photoUrl, bio: author.bio } });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Impossible de suivre cet auteur.' });
  }
});

// PATCH /api/authors/:key/follow
router.patch('/:key/follow', requireAuth, async (req, res) => {
  try {
    const { autoRequest } = req.body;
    await updateFollow(req.user.id, req.params.key, autoRequest);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Erreur lors de la mise à jour.' });
  }
});

// DELETE /api/authors/:key/follow
router.delete('/:key/follow', requireAuth, async (req, res) => {
  try {
    await unfollowAuthor(req.user.id, req.params.key);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors du désabonnement.' });
  }
});

export default router;
