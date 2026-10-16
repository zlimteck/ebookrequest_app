import mongoose from 'mongoose';
import axios from 'axios';
import { testAIProviderConnection, getProviderInfo } from '../services/aiProviderService.js';
import AIRequestLog from '../models/AIRequestLog.js';
import ConnectorSettings from '../models/ConnectorSettings.js';
import { getValentineQuota, getValentineCircuitStatus } from '../services/valentineService.js';
import { pingAnnasArchive, getAnnasArchiveConfig } from '../services/annasArchiveService.js';
import { testCalibreConnection } from '../services/calibreService.js';
import { decrypt } from '../services/cryptoService.js';
import { getGoogleBooksApiKey, isGoogleBooksSearchEnabled } from '../services/googleBooksConfig.js';
import { getHardcoverApiKey, getHardcoverQuotaStatus } from '../services/hardcoverConfig.js';
import { getProxyConfig, getProxyAgent } from '../services/proxyConfig.js';
import { getRSSFeedUrl } from '../services/rssConfig.js';

const CF_SCRAPER_URL = process.env.FLARESOLVERR_URL || 'http://flaresolverr:8191';

// Client de téléchargement torrent (qBittorrent/rTorrent/Deluge/Transmission,
// service: 'downloadClient') — "configuré" se mesure sur downloadClientType
// (pas de champ `enabled` dédié pour ce connecteur), même raisonnement que
// les autres : pas de vérification réseau si rien n'est choisi.
async function checkDownloadClient() {
  try {
    const { getDownloadClientConfig, getTorrentStatus } = await import('../services/downloadClients/index.js');
    const config = await getDownloadClientConfig();
    if (!config?.downloadClientType) return { enabled: false, connected: false, error: null };
    if (!config.url) {
      return { enabled: true, connected: false, error: 'URL non configurée' };
    }
    // Même technique que POST /api/connectors/downloadclient/test : un hash
    // arbitraire absent du client renvoie null (connexion/auth réussie),
    // une vraie erreur d'authentification/réseau lève une exception.
    await getTorrentStatus('0000000000000000000000000000000000000000');
    return { enabled: true, connected: true, type: config.downloadClientType, url: config.url, error: null };
  } catch (err) {
    return { enabled: true, connected: false, error: err.message };
  }
}

// Fournisseur email (SMTP ou Resend, service: 'emailProvider') — `enabled`
// ici reflète le réglage admin (sinon l'app retombe sur les variables d'env,
// toujours fonctionnel mais pas "configuré" au sens de ce connecteur).
async function checkEmailProvider() {
  try {
    const doc = await ConnectorSettings.findOne({ service: 'emailProvider' }).lean();
    if (!doc?.enabled || !doc?.provider) return { enabled: false, connected: false, provider: null, error: null };
    const secret = doc.apiKey ? (decrypt(doc.apiKey) ?? doc.apiKey) : '';

    if (doc.provider === 'resend') {
      if (!secret) return { enabled: true, connected: false, provider: 'resend', error: 'Clé API non configurée' };
      // Appel en lecture seule (liste des domaines) plutôt qu'un envoi
      // d'email de test, pour ne jamais spammer une vraie boîte à chaque
      // vérification périodique de la santé des services.
      const { Resend } = await import('resend');
      const client = new Resend(secret);
      const { error } = await client.domains.list();
      if (error) return { enabled: true, connected: false, provider: 'resend', error: error.message || 'Clé API invalide' };
      return { enabled: true, connected: true, provider: 'resend', error: null };
    }

    if (!doc.smtpHost) return { enabled: true, connected: false, provider: 'smtp', error: 'Hôte SMTP non configuré' };
    const { default: nodemailer } = await import('nodemailer');
    const transporter = nodemailer.createTransport({
      host: doc.smtpHost,
      port: doc.smtpPort || 465,
      secure: !!doc.smtpSecure,
      auth: { user: doc.username, pass: secret },
      tls: { rejectUnauthorized: false },
    });
    await transporter.verify();
    return { enabled: true, connected: true, provider: 'smtp', error: null };
  } catch (err) {
    return { enabled: true, connected: false, provider: null, error: err.message };
  }
}

// Flux RSS (predb.me ou équivalent, service: 'rss') — simple vérification de
// joignabilité (pas de parsing XML complet, pour rester léger sur un check
// périodique).
async function checkRssFeed() {
  try {
    const url = await getRSSFeedUrl();
    if (!url) return { enabled: false, connected: false, url: null, error: null };
    const res = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EbookRequest-HealthCheck)' },
      timeout: 8000,
      validateStatus: () => true,
    });
    if (res.status >= 400) return { enabled: true, connected: false, url, error: `HTTP ${res.status}` };
    return { enabled: true, connected: true, url, error: null };
  } catch (err) {
    return { enabled: true, connected: false, url: null, error: err.message };
  }
}

// Stockage distant des ebooks (issue #45) — WebDAV uniquement pour l'instant.
async function checkBookStorage() {
  const doc = await ConnectorSettings.findOne({ service: 'bookStorage' }).lean();
  const mode = doc?.fileStorageMode || 'local';
  if (mode === 'local') return { mode, connected: null, url: null, error: null };
  try {
    if (mode === 's3') {
      if (!doc?.bookStorageS3Endpoint || !doc?.bookStorageS3Bucket) {
        return { mode, connected: false, url: null, error: 'Endpoint ou bucket S3 non configuré' };
      }
      const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
      const client = new S3Client({
        endpoint: doc.bookStorageS3Endpoint,
        region: doc.bookStorageS3Region || 'auto',
        credentials: {
          accessKeyId: doc.bookStorageS3AccessKeyId || '',
          secretAccessKey: doc.bookStorageS3SecretAccessKey ? decrypt(doc.bookStorageS3SecretAccessKey) : '',
        },
        forcePathStyle: true,
      });
      await client.send(new ListObjectsV2Command({ Bucket: doc.bookStorageS3Bucket, MaxKeys: 1 }));
      return { mode, connected: true, url: doc.bookStorageS3Bucket, error: null };
    }
    const { createClient } = await import('webdav');
    if (!doc?.bookStorageWebdavUrl) return { mode, connected: false, url: null, error: 'URL WebDAV non configurée' };
    const client = createClient(doc.bookStorageWebdavUrl, {
      username: doc.bookStorageWebdavUsername || undefined,
      password: doc.bookStorageWebdavPassword ? decrypt(doc.bookStorageWebdavPassword) : undefined,
    });
    await client.getDirectoryContents('/');
    return { mode, connected: true, url: doc.bookStorageWebdavUrl, error: null };
  } catch (err) {
    return { mode, connected: false, url: null, error: err.message };
  }
}

// Destinations de sauvegarde distantes (S3/WebDAV, potentiellement plusieurs
// à la fois) — une entrée par destination activée, même raisonnement que
// pour le bouton "Tester" du panneau Sauvegarde mais en lecture seule ici.
async function checkRemoteBackupDestinations() {
  try {
    const { getDestinations } = await import('../services/remoteBackupService.js');
    const { createClient } = await import('webdav');
    const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    const destinations = (await getDestinations()).filter(d => d.enabled);
    return Promise.all(destinations.map(async (d) => {
      const label = d.label || (d.type === 's3' ? 'S3' : 'WebDAV');
      try {
        if (d.type === 's3') {
          const client = new S3Client({
            endpoint: d.s3Endpoint,
            region: d.s3Region || 'auto',
            credentials: { accessKeyId: d.s3AccessKeyId, secretAccessKey: decrypt(d.s3SecretAccessKey) },
            forcePathStyle: true,
          });
          await client.send(new ListObjectsV2Command({ Bucket: d.s3Bucket, MaxKeys: 1 }));
          return { id: d.id, type: 's3', label, connected: true, target: d.s3Bucket, error: null };
        }
        const client = createClient(d.webdavUrl, {
          username: d.webdavUsername || undefined,
          password: d.webdavPassword ? decrypt(d.webdavPassword) : undefined,
        });
        await client.getDirectoryContents('/');
        return { id: d.id, type: 'webdav', label, connected: true, target: d.webdavUrl, error: null };
      } catch (err) {
        return { id: d.id, type: d.type, label, connected: false, target: d.type === 's3' ? d.s3Bucket : d.webdavUrl, error: err.message };
      }
    }));
  } catch (err) {
    return [];
  }
}

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
    const res = await axios.get(`${CF_SCRAPER_URL}/`, { timeout: 4000, validateStatus: () => true });
    const connected = res.status < 500;
    const version = res.data?.version || null;
    return { connected, version, error: null };
  } catch (err) {
    return { connected: false, version: null, error: err.message };
  }
}

async function checkValentineConnector() {
  const circuitBreaker = getValentineCircuitStatus();
  try {
    const doc = await ConnectorSettings.findOne({ service: 'valentine' }).lean();
    if (!doc?.enabled || !doc?.username || !doc?.password) return { enabled: false, connected: false, quota: null, circuitBreaker, error: null };
    const password = decrypt(doc.password) ?? doc.password;
    const quota = await getValentineQuota(doc.username, password);
    return { enabled: true, connected: true, quota, circuitBreaker, error: null };
  } catch (err) {
    return { enabled: true, connected: false, quota: null, circuitBreaker: getValentineCircuitStatus(), error: err.message };
  }
}

async function checkAnnasArchiveConnector() {
  try {
    const config = await getAnnasArchiveConfig();
    if (!config?.enabled) return { enabled: false, connected: false, error: null };
    // `searchable` distingue « site joignable » de « réellement utilisable » : la racine
    // répond 200 même quand /search est protégé par DDoS-Guard, auquel cas recherche et
    // téléchargement automatique sont hors service.
    const { reachable, searchable } = await pingAnnasArchive();
    return { enabled: true, connected: reachable, searchable, error: null };
  } catch (err) {
    return { enabled: true, connected: false, searchable: false, error: err.message };
  }
}

async function checkFourtouticiConnector() {
  try {
    const { getFourtouticiConfig, pingFourtoutici } = await import('../services/fourtouticiService.js');
    const config = await getFourtouticiConfig();
    if (!config?.enabled) return { enabled: false, connected: false, url: null, error: null };
    const { baseUrl } = await pingFourtoutici();
    return { enabled: true, connected: true, url: baseUrl, error: null };
  } catch (err) {
    return { enabled: true, connected: false, url: null, error: err.message };
  }
}

async function checkLibgenConnector() {
  try {
    const { getLibgenConfig, pingLibgen } = await import('../services/libgenService.js');
    const config = await getLibgenConfig();
    if (!config?.enabled) return { enabled: false, connected: false, url: null, error: null };
    const { baseUrl } = await pingLibgen();
    return { enabled: true, connected: true, url: baseUrl, error: null };
  } catch (err) {
    return { enabled: true, connected: false, url: null, error: err.message };
  }
}

// UZ : pas de login programmatique (hCaptcha), session dépendante d'un
// cookie collé à la main par l'admin — contrairement aux autres connecteurs,
// une déconnexion ici n'est jamais transitoire (elle ne se résout pas seule au
// prochain essai), d'où le message différent pour guider l'action corrective.
async function checkUltimZoneConnector() {
  try {
    const { getUltimZoneConfig, pingUltimZone } = await import('../services/uzService.js');
    const config = await getUltimZoneConfig();
    if (!config?.enabled) return { enabled: false, connected: false, url: null, error: null };
    if (!config.apiKey || !config.password) {
      return { enabled: true, connected: false, url: config.url || null, error: 'Cookie de session non configuré' };
    }
    const { baseUrl } = await pingUltimZone();
    return { enabled: true, connected: true, url: baseUrl, error: null };
  } catch (err) {
    return { enabled: true, connected: false, url: null, error: err.message };
  }
}

async function checkProwlarrConnector() {
  try {
    const { getProwlarrConfig, pingProwlarr, fetchProwlarrIndexers, fetchProwlarrDownloadClients } = await import('../services/prowlarrService.js');
    const config = await getProwlarrConfig();
    if (!config?.enabled) return { enabled: false, connected: false, url: null, error: null };
    if (!config.url || !config.apiKey) {
      return { enabled: true, connected: false, url: config.url || null, error: 'URL ou clé API non configurée' };
    }
    const { version } = await pingProwlarr();
    const [indexers, downloadClients] = await Promise.all([
      fetchProwlarrIndexers().catch(() => []),
      fetchProwlarrDownloadClients().catch(() => []),
    ]);
    return {
      enabled: true,
      connected: true,
      url: config.url,
      version,
      indexersActive: indexers.filter(i => i.enabled).length,
      indexersTotal: indexers.length,
      downloadClientsActive: downloadClients.filter(c => c.enabled).length,
      downloadClientsTotal: downloadClients.length,
      error: null,
    };
  } catch (err) {
    return { enabled: true, connected: false, url: null, error: err.message };
  }
}

async function checkGoogleBooks() {
  // `enabled` doit refléter isGoogleBooksSearchEnabled() (ce qui gouverne réellement
  // /api/books/search), pas seulement "une clé API est disponible" — getGoogleBooksApiKey()
  // retombe sur GOOGLE_BOOKS_API_KEY (.env) même quand le toggle admin est désactivé,
  // ce qui faisait afficher Google Books comme actif/connecté dans Santé des services
  // alors que la recherche l'ignorait complètement.
  const searchEnabled = await isGoogleBooksSearchEnabled();
  const apiKey = await getGoogleBooksApiKey();
  if (!apiKey) return { enabled: searchEnabled, connected: false, error: null };
  try {
    let res;
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      res = await axios.get('https://www.googleapis.com/books/v1/volumes', {
        params: { q: 'test', maxResults: 1, key: apiKey },
        timeout: 6000,
        validateStatus: () => true,
      });
      if (res.status !== 503 || attempt === maxAttempts - 1) break;
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
    }
    if (res.status === 200) {
      return {
        enabled: searchEnabled,
        connected: true,
        error: null,
        totalItems: res.data?.totalItems ?? null,
      };
    }
    const reason = res.data?.error?.errors?.[0]?.reason || res.data?.error?.status || `HTTP ${res.status}`;
    return { enabled: searchEnabled, connected: false, error: reason };
  } catch (err) {
    return { enabled: searchEnabled, connected: false, error: err.message };
  }
}

async function checkHardcover() {
  const apiKey = await getHardcoverApiKey();
  if (!apiKey) return { enabled: false, connected: false, error: null };
  try {
    const res = await axios.post(
      'https://api.hardcover.app/v1/graphql',
      { query: '{ me { username } }' },
      {
        timeout: 6000,
        validateStatus: () => true,
        headers: {
          'Content-Type': 'application/json',
          Authorization: apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`,
        },
      }
    );
    if (res.status === 200 && !res.data?.errors) {
      return {
        enabled: true,
        connected: true,
        error: null,
        username: res.data?.data?.me?.[0]?.username ?? res.data?.data?.me?.username ?? null,
        quota: getHardcoverQuotaStatus(),
      };
    }
    const reason = res.data?.errors?.[0]?.message || `HTTP ${res.status}`;
    return { enabled: true, connected: false, error: reason, quota: getHardcoverQuotaStatus() };
  } catch (err) {
    return { enabled: true, connected: false, error: err.message, quota: getHardcoverQuotaStatus() };
  }
}

async function checkProxy() {
  const proxy = await getProxyConfig();
  if (!proxy.enabled) return { enabled: false, connected: false, mode: null, error: null };
  try {
    const res = await axios.get('https://api.ipify.org?format=json', {
      httpsAgent: getProxyAgent(proxy.url),
      proxy: false,
      timeout: 8000,
      validateStatus: () => true,
    });
    if (res.status === 200 && res.data?.ip) {
      return { enabled: true, connected: true, mode: proxy.mode, error: null, exitIp: res.data.ip };
    }
    return { enabled: true, connected: false, mode: proxy.mode, error: `HTTP ${res.status}` };
  } catch (err) {
    return { enabled: true, connected: false, mode: proxy.mode, error: err.message };
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

// Délègue à getStorageStats() (fileStorageService.js), seul endroit qui
// connaît le mode de stockage actif (local/webdav/s3) — un parcours direct
// de UPLOADS_DIR ne verrait jamais les fichiers distants une fois le mode
// changé. Ne compte volontairement que les ebooks (comme getStorageStats()),
// plus les sauvegardes/avatars/fichiers temporaires du reste de uploads/.
async function getUploadsStats() {
  try {
    const { getStorageStats } = await import('../services/fileStorageService.js');
    const { fileCount, totalBytes } = await getStorageStats();
    return { totalSize: totalBytes, fileCount };
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

    const providerInfo = await getProviderInfo();
    const uploadsStats = await getUploadsStats();

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
// `label` sert à deux choses : un message d'erreur plus parlant que le mot
// "timeout" seul côté réponse ("Délai dépassé (8000ms)"), et un repère dans
// les logs serveur si la vraie promesse finit par se résoudre/rejeter après
// le délai, pour retrouver la raison réelle d'un échec qui a mis trop de
// temps à répondre plutôt qu'une erreur franche et immédiate.
function withTimeout(promise, ms, fallback, label) {
  let settled = false;
  const tracked = promise.then(
    (value) => { settled = true; return value; },
    (err) => { settled = true; throw err; }
  );
  tracked.catch((err) => {
    if (label) console.warn(`[Santé des services] "${label}" a fini par échouer après coup : ${err.message}`);
  });
  return Promise.race([
    tracked,
    new Promise(resolve => setTimeout(() => {
      if (settled) return; // déjà réglée entre-temps, la race a juste pris l'autre branche de peu
      resolve({ ...fallback, error: `Délai dépassé (${ms}ms)${label ? ` : ${label}` : ''}` });
    }, ms)),
  ]);
}

export const getServicesHealth = async (req, res) => {
  try {
    const providerInfo = await getProviderInfo();
    const [aiStatus, flareSolverr, apprise, calibreWeb, valentine, annasArchive, mcp, googleBooks, hardcover, proxy, fourtoutici, ultimZone, prowlarr, bookStorage, remoteBackupDestinations, downloadClient, emailProvider, rssFeed, libgen] = await Promise.all([
      withTimeout(testAIProviderConnection(), 8000, { connected: false, error: 'timeout' }, 'Fournisseur IA'),
      withTimeout(checkFlareSolverr(), 6000, { connected: false, error: 'timeout' }, 'FlareSolverr'),
      withTimeout(checkAppriseServer(), 6000, { reachable: false, error: 'timeout' }, 'Apprise'),
      withTimeout(checkCalibreWeb(), 6000, { enabled: false, connected: false, error: 'timeout' }, 'Calibre-Web'),
      withTimeout(checkValentineConnector(), 8000, { enabled: true, connected: false, quota: null, error: 'timeout' }, 'Valentine'),
      withTimeout(checkAnnasArchiveConnector(), 8000, { enabled: true, connected: false, error: 'timeout' }, "Anna's Archive"),
      withTimeout(checkMcpServer(), 6000, { enabled: false, connected: false, error: 'timeout' }, 'Serveur MCP'),
      withTimeout(checkGoogleBooks(), 6000, { enabled: true, connected: false, error: 'timeout' }, 'Google Books'),
      withTimeout(checkHardcover(), 6000, { enabled: true, connected: false, error: 'timeout' }, 'Hardcover'),
      withTimeout(checkProxy(), 8000, { enabled: false, connected: false, mode: null, error: 'timeout' }, 'Proxy sortant'),
      withTimeout(checkFourtouticiConnector(), 8000, { enabled: true, connected: false, error: 'timeout' }, 'Fourtoutici'),
      withTimeout(checkUltimZoneConnector(), 8000, { enabled: true, connected: false, error: 'timeout' }, 'Ultim-Zone'),
      withTimeout(checkProwlarrConnector(), 8000, { enabled: true, connected: false, error: 'timeout' }, 'Prowlarr'),
      withTimeout(checkBookStorage(), 8000, { mode: 'local', connected: null, url: null, error: 'timeout' }, 'Stockage des ebooks'),
      withTimeout(checkRemoteBackupDestinations(), 8000, []),
      withTimeout(checkDownloadClient(), 8000, { enabled: true, connected: false, error: 'timeout' }, 'Client de téléchargement'),
      withTimeout(checkEmailProvider(), 8000, { enabled: true, connected: false, provider: null, error: 'timeout' }, 'Fournisseur email'),
      withTimeout(checkRssFeed(), 8000, { enabled: true, connected: false, url: null, error: 'timeout' }, 'Flux RSS'),
      withTimeout(checkLibgenConnector(), 8000, { enabled: true, connected: false, url: null, error: 'timeout' }, 'LibGen'),
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
          searchable: annasArchive.searchable ?? null,
          error: annasArchive.error || null,
        },
        mcp: {
          enabled: mcp.enabled,
          connected: mcp.connected,
          url: mcp.url || null,
          error: mcp.error || null,
        },
        googleBooks: {
          enabled: googleBooks.enabled,
          connected: googleBooks.connected,
          error: googleBooks.error || null,
          totalItems: googleBooks.totalItems ?? null,
        },
        hardcover: {
          enabled: hardcover.enabled,
          connected: hardcover.connected,
          error: hardcover.error || null,
          username: hardcover.username || null,
          quota: hardcover.quota || null,
        },
        proxy: {
          enabled: proxy.enabled,
          connected: proxy.connected,
          mode: proxy.mode || null,
          exitIp: proxy.exitIp || null,
          error: proxy.error || null,
        },
        fourtoutici: {
          enabled: fourtoutici.enabled,
          connected: fourtoutici.connected,
          url: fourtoutici.url || null,
          error: fourtoutici.error || null,
        },
        libgen: {
          enabled: libgen.enabled,
          connected: libgen.connected,
          url: libgen.url || null,
          error: libgen.error || null,
        },
        ultimZone: {
          enabled: ultimZone.enabled,
          connected: ultimZone.connected,
          url: ultimZone.url || null,
          error: ultimZone.error || null,
        },
        prowlarr: {
          enabled: prowlarr.enabled,
          connected: prowlarr.connected,
          url: prowlarr.url || null,
          version: prowlarr.version || null,
          indexersActive: prowlarr.indexersActive ?? null,
          indexersTotal: prowlarr.indexersTotal ?? null,
          downloadClientsActive: prowlarr.downloadClientsActive ?? null,
          downloadClientsTotal: prowlarr.downloadClientsTotal ?? null,
          error: prowlarr.error || null,
        },
        bookStorage: {
          mode: bookStorage.mode,
          connected: bookStorage.connected,
          url: bookStorage.url || null,
          error: bookStorage.error || null,
        },
        remoteBackupDestinations,
        downloadClient: {
          enabled: downloadClient.enabled,
          connected: downloadClient.connected,
          type: downloadClient.type || null,
          url: downloadClient.url || null,
          error: downloadClient.error || null,
        },
        emailProvider: {
          enabled: emailProvider.enabled,
          connected: emailProvider.connected,
          provider: emailProvider.provider || null,
          error: emailProvider.error || null,
        },
        rss: {
          enabled: rssFeed.enabled,
          connected: rssFeed.connected,
          url: rssFeed.url || null,
          error: rssFeed.error || null,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Erreur lors de la vérification des services' });
  }
};