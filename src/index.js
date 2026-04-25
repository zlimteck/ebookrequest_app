import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import bookRequestRoutes from './routes/bookRequest.js';
import authRoutes from './routes/auth.js';
import twoFactorRoutes from './routes/twoFactor.js';
import googleBooksRoutes from './routes/googleBooks.js';
import appriseRoutes from './routes/apprise.js';
import notificationRoutes from './routes/notifications.js';
import userRoutes from './routes/user.js';
import adminUserRoutes from './routes/users.js';
import adminRoutes from './routes/admin.js';
import activityRoutes from './routes/activity.js';
import availabilityRoutes from './routes/availability.js';
import trendingRoutes from './routes/trending.js';
import bestsellerRoutes from './routes/bestsellers.js';
import recommendationRoutes from './routes/recommendations.js';
import adminLogsRoutes from './routes/adminLogs.js';
import pushRoutes from './routes/push.js';
import readingRoutes from './routes/reading.js';
import broadcastRoutes from './routes/broadcast.js';
import releasesRoutes from './routes/releases.js';
import invitationsRoutes from './routes/invitations.js';
import connectorsRoutes from './routes/connectors.js';
import emailLogsRoutes from './routes/emailLogs.js';
import webhooksRoutes from './routes/webhooks.js';
import opdsRoutes from './routes/opds.js';
import opdsAdminRoutes from './routes/opdsAdmin.js';
import { createRequire } from 'module';
import { initializeTrendingBooksCache } from './services/trendingBooksService.js';

const require = createRequire(import.meta.url);
const { version: APP_VERSION } = require('../package.json');

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

const app = express();
const PORT = process.env.PORT || 5001;

// Configuration CORS dynamique basée sur les variables d'environnement
const corsOptions = {
  origin: function (origin, callback) {
    // En développement, autoriser toutes les origines
    if (process.env.NODE_ENV === 'development' || !origin) {
      return callback(null, true);
    }

    const allowedOrigins = [
      process.env.FRONTEND_URL,
      process.env.REACT_APP_API_URL,
    ].filter(Boolean);

    // Vérifier si l'origine est autorisée
    if (allowedOrigins.some(allowedOrigin => 
      origin === allowedOrigin || 
      origin.startsWith(allowedOrigin.replace(/^https?:\/\//, 'http://')) ||
      origin.startsWith(allowedOrigin.replace(/^https?:\/\//, 'https://'))
    )) {
      callback(null, true);
    } else {
      console.warn('Tentative d\'accès non autorisée depuis :', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Disposition']
};

app.use(cors(corsOptions));
// Augmentation des limites pour gérer les fichiers jusqu'à 500MB
app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ limit: '500mb', extended: true }));

// Faire confiance au reverse proxy (nginx) pour les vraies IPs clients
app.set('trust proxy', 1);

// Rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: 'Trop de tentatives, réessayez dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  message: { error: 'Trop de requêtes, ralentissez.' },
  standardHeaders: true,
  legacyHeaders: false,
});
const twoFactorLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Trop de tentatives 2FA' },
  standardHeaders: true,
  legacyHeaders: false,
});
// Light rate limiter for OPDS endpoints (ebook readers, no OAuth)
const opdsLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: 'Trop de requêtes OPDS, réessayez dans une minute.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/opds', opdsLimiter, opdsRoutes);

app.use('/api/auth/2fa', twoFactorLimiter, twoFactorRoutes);
app.use('/api/auth', authLimiter);
app.use('/api', generalLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/requests', bookRequestRoutes);
app.use('/api/books', googleBooksRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/apprise', appriseRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin/users', adminUserRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/availability', availabilityRoutes);
app.use('/api/trending', trendingRoutes);
app.use('/api/admin/bestsellers', bestsellerRoutes);
app.use('/api/recommendations', recommendationRoutes);
app.use('/api/admin/logs', adminLogsRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/reading', readingRoutes);
app.use('/api/admin/broadcast', broadcastRoutes);
app.use('/api/admin/releases', releasesRoutes);
app.use('/api/admin/email-logs', emailLogsRoutes);
app.use('/api/admin/opds', opdsAdminRoutes);
app.use('/api/webhooks', webhooksRoutes);
app.use('/api/invitations', invitationsRoutes);
app.use('/api/connectors', connectorsRoutes);

// Route de santé + version
app.get('/api/health', (req, res) => res.json({ status: 'ok', version: APP_VERSION }));

// Servir le build React (production)
const frontendBuild = path.join(__dirname, '../frontend/build');
app.use(express.static(frontendBuild));

// Toutes les routes non-API → index.html (React Router)
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendBuild, 'index.html'));
});

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  app.listen(PORT, () => {
    console.log(`Serveur backend lancé sur le port ${PORT}`);

    // Initialiser le cache des livres tendance au démarrage (sans bloquer le serveur)
    initializeTrendingBooksCache();
  });
})
.catch((error) => console.error('Erreur de connexion MongoDB:', error));