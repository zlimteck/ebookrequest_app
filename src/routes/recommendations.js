import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import BookRequest from '../models/BookRequest.js';
import Recommendation from '../models/Recommendation.js';
import { generateRecommendations } from '../services/recommendationService.js';
import { testAIProviderConnection } from '../services/aiProviderService.js';

const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

async function getUserBookRequests(userId) {
  return BookRequest.find({ user: userId })
    .sort({ createdAt: -1 })
    .select('title author description pageCount')
    .lean();
}

// ── GET /api/recommendations ──────────────────────────────────────────────────
// Retourne le cache si disponible, génère la première fois (gratuit, sans quota)
router.get('/', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = parseInt(req.query.limit) || 5;

    // Chercher un cache existant
    const cached = await Recommendation.findOne({ user: userId });

    if (cached && cached.recommendations.length > 0) {
      const info = cached.getRateLimitInfo();
      return res.json({
        success: true,
        recommendations: cached.recommendations,
        cached: true,
        generatedAt: cached.generatedAt,
        message: '',
        ...info,
      });
    }

    // Première génération — ne compte pas dans le quota
    const bookRequests = await getUserBookRequests(userId);
    const result = await generateRecommendations(bookRequests, limit, userId, req.user.username);

    const doc = await Recommendation.findOneAndUpdate(
      { user: userId },
      {
        recommendations: result.recommendations,
        generatedAt: new Date(),
        regenerationCount: 0,
        windowStart: new Date(),
      },
      { upsert: true, new: true }
    );

    const info = doc.getRateLimitInfo();
    return res.json({
      success: true,
      recommendations: result.recommendations,
      cached: false,
      generatedAt: doc.generatedAt,
      message: result.message || '',
      totalRequests: bookRequests.length,
      ...info,
    });

  } catch (error) {
    console.error('Erreur recommandations GET:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du chargement des recommandations',
      recommendations: [],
    });
  }
});

// ── POST /api/recommendations/regenerate ─────────────────────────────────────
// Régénère en consommant 1 quota (max 3 par 7 jours)
router.post('/regenerate', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = 5;

    let doc = await Recommendation.findOne({ user: userId });

    // Créer un document vide si premier accès
    if (!doc) {
      doc = new Recommendation({ user: userId, recommendations: [], regenerationCount: 0, windowStart: new Date() });
    }

    // Vérifier la limite
    if (!doc.canRegenerate()) {
      const info = doc.getRateLimitInfo();
      return res.status(429).json({
        success: false,
        message: `Limite de régénération atteinte (${info.regenerationsMax} par ${7} jours).`,
        recommendations: doc.recommendations,
        cached: true,
        generatedAt: doc.generatedAt,
        ...info,
      });
    }

    // Générer
    const bookRequests = await getUserBookRequests(userId);
    const result = await generateRecommendations(bookRequests, limit, userId, req.user.username);

    // Incrémenter le compteur (fenêtre déjà réinitialisée si expirée dans canRegenerate)
    doc.recommendations = result.recommendations;
    doc.generatedAt = new Date();
    doc.regenerationCount += 1;
    await doc.save();

    const info = doc.getRateLimitInfo();
    return res.json({
      success: true,
      recommendations: result.recommendations,
      cached: false,
      generatedAt: doc.generatedAt,
      message: result.message || '',
      totalRequests: bookRequests.length,
      ...info,
    });

  } catch (error) {
    console.error('Erreur recommandations régénération:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la régénération des recommandations',
      recommendations: [],
    });
  }
});

// ── GET /api/recommendations/status ──────────────────────────────────────────
router.get('/status', requireAuth, async (req, res) => {
  try {
    const status = await testAIProviderConnection();
    res.json({ success: true, ...status });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur lors du test de connexion', error: error.message });
  }
});

export default router;