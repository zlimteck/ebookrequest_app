import User from '../models/User.js';
import Recommendation from '../models/Recommendation.js';
import ConnectorSettings from '../models/ConnectorSettings.js';
import AdminLog from '../models/AdminLog.js';
import { isAIConfigured } from './aiProviderService.js';
import { generateRecommendations, getUserBookRequests, getUserLibraryBooks } from './recommendationService.js';

// Rafraîchit une fois par semaine les recommandations IA de chaque utilisateur
// ayant assez de signal (au moins une demande ou un livre lu) — rend le widget
// de la page de demande réellement proactif (déjà à jour à l'ouverture) plutôt
// que de ne générer qu'à la première visite. Ne consomme pas le quota de
// régénération manuelle de l'utilisateur (compteur non incrémenté).
const INTERVAL_HOURS = 24;
const STARTUP_DELAY_MS = 10 * 60 * 1000;
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

async function runRecommendationsCron() {
  try {
    if (!(await isAIConfigured())) return;

    const settings = await ConnectorSettings.findOne({ service: 'aiProvider' }).select('recommendationsAutoRefresh').lean();
    if (settings?.recommendationsAutoRefresh === false) return;

    const staleBefore = new Date(Date.now() - STALE_AFTER_MS);
    const users = await User.find({}).select('username').lean();
    let refreshed = 0;

    for (const user of users) {
      try {
        const existing = await Recommendation.findOne({ user: user._id });
        if (existing && existing.generatedAt > staleBefore) continue;

        const [bookRequests, libraryBooks] = await Promise.all([
          getUserBookRequests(user._id),
          getUserLibraryBooks(user._id),
        ]);
        if (bookRequests.length === 0 && libraryBooks.length === 0) continue;

        const result = await generateRecommendations(bookRequests, 5, user._id, user.username, libraryBooks);
        if (result.recommendations.length === 0) continue;

        await Recommendation.findOneAndUpdate(
          { user: user._id },
          { recommendations: result.recommendations, generatedAt: new Date() },
          { upsert: true, setDefaultsOnInsert: true }
        );
        refreshed++;
      } catch (e) {
        console.error(`[RecommendationsCron] Erreur pour ${user.username}:`, e.message);
      }
    }

    if (refreshed > 0) {
      console.log(`[RecommendationsCron] ${refreshed} recommandation(s) rafraîchie(s)`);
      AdminLog.create({
        adminUsername: 'Système',
        action: 'cron_run',
        details: `Recommandations IA : ${refreshed} utilisateur(s) rafraîchi(s) automatiquement.`,
      }).catch(() => {});
    }
  } catch (e) {
    console.error('[RecommendationsCron] Erreur:', e.message);
    AdminLog.create({
      adminUsername: 'Système',
      action: 'cron_run',
      details: `Recommandations IA : échec du rafraîchissement automatique (${e.message}).`,
    }).catch(() => {});
  }
}

let cronIntervalId = null;
let startupTimeoutId = null;

export function startRecommendationsCron() {
  if (cronIntervalId) clearInterval(cronIntervalId);
  if (startupTimeoutId) clearTimeout(startupTimeoutId);

  startupTimeoutId = setTimeout(() => {
    runRecommendationsCron();
    cronIntervalId = setInterval(runRecommendationsCron, INTERVAL_HOURS * 60 * 60 * 1000);
  }, STARTUP_DELAY_MS);
}
