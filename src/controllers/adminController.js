import mongoose from 'mongoose';
import { testAIProviderConnection, getProviderInfo } from '../services/aiProviderService.js';
import AIRequestLog from '../models/AIRequestLog.js';

const getISOWeek = (d) => {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
};

const formatWeekLabel = (d) => {
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
};

const User = mongoose.model('User');
const BookRequest = mongoose.model('BookRequest');

// Récupère les statistiques administratives
export const getAdminStats = async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Accès non autorisé. Rôle administrateur requis.'
      });
    }
    const totalUsers = await User.countDocuments({});
    const totalRequests = await BookRequest.countDocuments({});
    const pendingRequests = await BookRequest.countDocuments({ status: 'pending' });
    const completedRequests = await BookRequest.countDocuments({ status: 'completed' });
    const cancelledRequests = await BookRequest.countDocuments({ status: 'canceled' });
    const reportedRequests = await BookRequest.countDocuments({ status: 'reported' });
    const completionRate = totalRequests > 0
      ? Math.round((completedRequests / totalRequests) * 100)
      : 0;

    // Vérifier le statut du provider IA configuré
    const aiProviderStatus = await testAIProviderConnection();
    const providerInfo = getProviderInfo();

    // Statistiques des requêtes IA
    const totalAIRequests = await AIRequestLog.countDocuments({});
    const successfulAIRequests = await AIRequestLog.countDocuments({ success: true });
    const failedAIRequests = await AIRequestLog.countDocuments({ success: false });
    const recommendationRequests = await AIRequestLog.countDocuments({ requestType: 'recommendation' });
    const bestsellerRequests = await AIRequestLog.countDocuments({ requestType: 'bestseller' });

    // Statistiques par provider
    const openaiRequests = await AIRequestLog.countDocuments({ provider: 'openai' });
    const ollamaRequests = await AIRequestLog.countDocuments({ provider: 'ollama' });

    // Calculer le temps de réponse moyen
    const avgResponseTime = await AIRequestLog.aggregate([
      { $match: { success: true, responseTime: { $ne: null } } },
      { $group: { _id: null, avgTime: { $avg: '$responseTime' } } }
    ]);

    // Calculer le nombre total de tokens utilisés
    const totalTokens = await AIRequestLog.aggregate([
      { $match: { success: true, tokensUsed: { $ne: null } } },
      { $group: { _id: null, total: { $sum: '$tokensUsed' } } }
    ]);

    // Demandes par semaine (12 dernières semaines)
    const twelveWeeksAgo = new Date();
    twelveWeeksAgo.setDate(twelveWeeksAgo.getDate() - 84);
    const weeklyRaw = await BookRequest.aggregate([
      { $match: { createdAt: { $gte: twelveWeeksAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%U', date: '$createdAt' } },
          count: { $sum: 1 },
          weekStart: { $min: '$createdAt' }
        }
      },
      { $sort: { '_id': 1 } }
    ]);
    // Remplir les semaines manquantes avec 0
    const weeksMap = {};
    for (let i = 11; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i * 7);
      const key = d.toISOString().slice(0, 4) + '-' + String(getISOWeek(d)).padStart(2, '0');
      weeksMap[key] = { label: formatWeekLabel(d), count: 0 };
    }
    weeklyRaw.forEach(w => {
      if (weeksMap[w._id]) weeksMap[w._id].count = w.count;
    });
    const requestsByWeek = Object.values(weeksMap);

    // Top 5 utilisateurs par nombre de demandes
    const topUsers = await BookRequest.aggregate([
      { $group: { _id: '$username', total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } } } },
      { $sort: { total: -1 } },
      { $limit: 5 },
      { $project: { _id: 0, username: '$_id', total: 1, completed: 1 } }
    ]);

    res.status(200).json({
      success: true,
      data: {
        users: {
          total: totalUsers
        },
        requests: {
          total: totalRequests,
          pending: pendingRequests,
          completed: completedRequests,
          cancelled: cancelledRequests,
          reported: reportedRequests,
          completionRate: completionRate
        },
        aiProvider: {
          connected: aiProviderStatus.connected,
          provider: providerInfo.provider,
          url: aiProviderStatus.url,
          model: aiProviderStatus.model,
          modelAvailable: aiProviderStatus.modelAvailable,
          availableModels: aiProviderStatus.availableModels || [],
          error: aiProviderStatus.error || null
        },
        aiRequests: {
          total: totalAIRequests,
          successful: successfulAIRequests,
          failed: failedAIRequests,
          byType: {
            recommendation: recommendationRequests,
            bestseller: bestsellerRequests
          },
          byProvider: {
            openai: openaiRequests,
            ollama: ollamaRequests
          },
          currentProvider: providerInfo.provider,
          currentModel: providerInfo.model,
          avgResponseTime: avgResponseTime.length > 0 ? Math.round(avgResponseTime[0].avgTime) : 0,
          totalTokens: totalTokens.length > 0 ? totalTokens[0].total : 0,
          successRate: totalAIRequests > 0 ? Math.round((successfulAIRequests / totalAIRequests) * 100) : 0
        },
        requestsByWeek,
        topUsers
      }
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des statistiques:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des statistiques administratives'
    });
  }
};