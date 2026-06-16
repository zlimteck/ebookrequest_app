import mongoose from 'mongoose';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { testAIProviderConnection, getProviderInfo } from '../services/aiProviderService.js';
import AIRequestLog from '../models/AIRequestLog.js';
import ConnectorSettings from '../models/ConnectorSettings.js';
import { getValentineQuota } from '../services/valentineService.js';
import { pingAnnasArchive, getAnnasArchiveConfig } from '../services/annasArchiveService.js';
import { pingPredbApi } from '../services/predbApiService.js';
import { testCalibreConnection } from '../services/calibreService.js';
import { decrypt } from '../services/cryptoService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.join(__dirname, '../../uploads');

const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || 'http://flaresolverr:8191';

async function checkMcpServer() {
  const mcpUrl = (process.env.MCP_URL || '').replace(/\/$/, '');
  const mcpInternalUrl = (process.env.MCP_INTERNAL_URL || mcpUrl).replace(/\/$/, '');
  if (!mcpUrl) return { enabled: false, connected: false, url: null, error: null };
  try {
    const res = await axios.get(`${mcpInternalUrl}/health`, { timeout: 4000 });
    const online = res.data?.status === 'ok';
    return { enabled: true, connected: online, url: `${mcpUrl}/mcp`, error: null };
  } catch (err) {
    return { enabled: true, connected: false, url: `${mcpUrl}/mcp`, error: err.message };
  }
}

async function checkFlareSolverr() {
  try {
    const res = await axios.get(FLARESOLVERR_URL, { timeout: 4000 });
    const version = res.data?.version || null;
    return { connected: true, version, error: null };
  } catch (err) {
    return { connected: false, version: null, error: err.message };
  }
}

async function checkValentineConnector() {
  try {
    const doc = await ConnectorSettings.findOne({ service: 'valentine' }).lean();
    if (!doc?.enabled || !doc?.username || !doc?.password) return { enabled: false, connected: false, quota: null, error: null };
    const password = decrypt(doc.password) ?? doc.password;
    const quota = await getValentineQuota(doc.username, password);
    return { enabled: true, connected: true, quota, error: null };
  } catch (err) {
    return { enabled: true, connected: false, quota: null, error: err.message };
  }
}

async function checkAnnasArchiveConnector() {
  try {
    const config = await getAnnasArchiveConfig();
    if (!config?.enabled) return { enabled: false, connected: false, error: null };
    await pingAnnasArchive();
    return { enabled: true, connected: true, error: null };
  } catch (err) {
    return { enabled: true, connected: false, error: err.message };
  }
}

async function checkPredbApiConnector() {
  try {
    return await pingPredbApi();
  } catch (err) {
    return { enabled: true, connected: false, error: err.message };
  }
}

async function checkAppriseServer() {
  try {
    const appriseUrl = (process.env.APPRISE_URL || 'http://apprise:8000').replace(/\/notify\/?$/, '');
    const res = await axios.get(`${appriseUrl}/status`, { timeout: 4000, validateStatus: () => true });
    if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
    return { reachable: true, error: null };
  } catch (err) {
    return { reachable: false, error: err.message || err.code || 'Connexion impossible' };
  }
}

async function checkCalibreWeb() {
  try {
    const User = mongoose.model('User');
    const admin = await User.findOne({ role: 'admin', 'calibreWeb.enabled': true }).lean();
    if (!admin?.calibreWeb?.enabled || !admin?.calibreWeb?.url) return { enabled: false, connected: false, error: null };
    const password = decrypt(admin.calibreWeb.password) ?? admin.calibreWeb.password;
    const result = await testCalibreConnection({
      url: admin.calibreWeb.url,
      username: admin.calibreWeb.username,
      password,
    });
    return { enabled: true, connected: result.connected, url: admin.calibreWeb.url, error: result.error || null };
  } catch (err) {
    return { enabled: true, connected: false, error: err.message };
  }
}

function getUploadsStats() {
  try {
    if (!fs.existsSync(UPLOADS_DIR)) return { totalSize: 0, fileCount: 0 };
    let totalSize = 0;
    let fileCount = 0;
    const walk = (dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          const stat = fs.statSync(fullPath);
          totalSize += stat.size;
          fileCount++;
        }
      }
    };
    walk(UPLOADS_DIR);
    return { totalSize, fileCount };
  } catch {
    return { totalSize: 0, fileCount: 0 };
  }
}

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
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const activeUsers = await User.countDocuments({ lastActivity: { $gte: thirtyDaysAgo } });
    const newUsers = await User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } });
    const usersWithPendingIds = await BookRequest.distinct('user', { status: 'pending' });
    const usersWithPending = usersWithPendingIds.length;

    const totalRequests = await BookRequest.countDocuments({});
    const pendingRequests = await BookRequest.countDocuments({ status: 'pending' });
    const completedRequests = await BookRequest.countDocuments({ status: 'completed' });
    const cancelledRequests = await BookRequest.countDocuments({ status: 'canceled' });
    const reportedRequests = await BookRequest.countDocuments({ status: 'reported' });
    const completionRate = totalRequests > 0
      ? Math.round((completedRequests / totalRequests) * 100)
      : 0;

    const providerInfo = getProviderInfo();
    const uploadsStats = getUploadsStats();

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

    // Stats Valentine
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const valentineTotal = await BookRequest.countDocuments({
      statusHistory: { $elemMatch: { changedBy: 'valentine', status: 'completed' } }
    });
    const valentineThisWeek = await BookRequest.countDocuments({
      completedAt: { $gte: sevenDaysAgo },
      statusHistory: { $elemMatch: { changedBy: 'valentine', status: 'completed' } }
    });
    const valentineSuccessRate = completedRequests > 0
      ? Math.round((valentineTotal / completedRequests) * 100)
      : 0;
    const valentineStuck = await BookRequest.countDocuments({
      status: 'pending',
      createdAt: { $lt: sevenDaysAgo }
    });

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
          total: totalUsers,
          active: activeUsers,
          new: newUsers,
          withPending: usersWithPending
        },
        requests: {
          total: totalRequests,
          pending: pendingRequests,
          completed: completedRequests,
          cancelled: cancelledRequests,
          reported: reportedRequests,
          completionRate: completionRate
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
        topUsers,
        valentine: {
          total: valentineTotal,
          thisWeek: valentineThisWeek,
          successRate: valentineSuccessRate,
          stuck: valentineStuck
        },
        uploads: {
          totalSize: uploadsStats.totalSize,
          fileCount: uploadsStats.fileCount,
        }
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

// Santé des services
export const getServicesHealth = async (req, res) => {
  try {
    const providerInfo = getProviderInfo();
    const [aiStatus, flareSolverr, apprise, calibreWeb, valentine, annasArchive, predb, mcp] = await Promise.all([
      testAIProviderConnection(),
      checkFlareSolverr(),
      checkAppriseServer(),
      checkCalibreWeb(),
      checkValentineConnector(),
      checkAnnasArchiveConnector(),
      checkPredbApiConnector(),
      checkMcpServer(),
    ]);

    res.json({
      success: true,
      checkedAt: new Date().toISOString(),
      services: {
        aiProvider: {
          connected: aiStatus.connected,
          provider: providerInfo.provider,
          model: aiStatus.model || providerInfo.model || null,
          modelAvailable: aiStatus.modelAvailable ?? null,
          error: aiStatus.error || null,
        },
        flareSolverr: {
          connected: flareSolverr.connected,
          version: flareSolverr.version || null,
          error: flareSolverr.error || null,
        },
        apprise: {
          reachable: apprise.reachable,
          error: apprise.error || null,
        },
        calibreWeb: {
          enabled: calibreWeb.enabled,
          connected: calibreWeb.connected,
          url: calibreWeb.url || null,
          error: calibreWeb.error || null,
        },
        valentine: {
          enabled: valentine.enabled,
          connected: valentine.connected,
          quota: valentine.quota || null,
          error: valentine.error || null,
        },
        annasArchive: {
          enabled: annasArchive.enabled,
          connected: annasArchive.connected,
          error: annasArchive.error || null,
        },
        predb: {
          enabled: predb.enabled,
          connected: predb.connected,
          error: predb.error || null,
        },
        mcp: {
          enabled: mcp.enabled,
          connected: mcp.connected,
          url: mcp.url || null,
          error: mcp.error || null,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Erreur lors de la vérification des services' });
  }
};