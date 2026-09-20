import Bestseller from '../models/Bestseller.js';
import ConnectorSettings from '../models/ConnectorSettings.js';
import AdminLog from '../models/AdminLog.js';
import { isAIConfigured } from './aiProviderService.js';
import { generateBestsellers, saveBestsellers } from './bestsellerGeneratorService.js';
import { clearTrendingBooksCache } from './trendingBooksService.js';

// Génère automatiquement les bestsellers du mois (page Découvrir) — jusqu'ici
// uniquement déclenchable manuellement par un admin depuis le panel, ce qui
// finit par ne jamais être fait en pratique. Vérifie une fois par jour si le
// mois courant a déjà du contenu généré, ne relance sinon qu'une fois par mois.
const INTERVAL_HOURS = 24;
const STARTUP_DELAY_MS = 15 * 60 * 1000;

async function runBestsellerCron() {
  try {
    if (!(await isAIConfigured())) return;

    const settings = await ConnectorSettings.findOne({ service: 'aiProvider' }).select('bestsellerAutoGenerate').lean();
    if (settings?.bestsellerAutoGenerate === false) return;

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const existingThisMonth = await Bestseller.countDocuments({ createdAt: { $gte: monthStart } });
    if (existingThisMonth > 0) return;

    console.log('[BestsellerCron] Génération mensuelle des bestsellers…');
    const result = await generateBestsellers();
    if (!result.success || !result.bestsellers) return;

    const savedCount = await saveBestsellers(result.bestsellers, null);

    // Désactive les bestsellers du mois précédent générés automatiquement
    // (addedBy: null) pour ne pas les accumuler indéfiniment avec les nouveaux —
    // ceux ajoutés manuellement par un admin (addedBy renseigné) ne sont jamais touchés.
    if (savedCount > 0) {
      await Bestseller.updateMany(
        { addedBy: null, createdAt: { $lt: monthStart } },
        { $set: { active: false } }
      );
      clearTrendingBooksCache();
    }

    console.log(`[BestsellerCron] ${savedCount} bestseller(s) enregistré(s) pour ${result.month}`);

    if (savedCount > 0) {
      AdminLog.create({
        adminUsername: 'Système',
        action: 'cron_run',
        details: `Bestsellers : ${savedCount} livre(s) généré(s) automatiquement pour ${result.month}.`,
      }).catch(() => {});
    }
  } catch (e) {
    console.error('[BestsellerCron] Erreur:', e.message);
    AdminLog.create({
      adminUsername: 'Système',
      action: 'cron_run',
      details: `Bestsellers : échec de la génération automatique (${e.message}).`,
    }).catch(() => {});
  }
}

let cronIntervalId = null;
let startupTimeoutId = null;

export function startBestsellerCron() {
  if (cronIntervalId) clearInterval(cronIntervalId);
  if (startupTimeoutId) clearTimeout(startupTimeoutId);

  startupTimeoutId = setTimeout(() => {
    runBestsellerCron();
    cronIntervalId = setInterval(runBestsellerCron, INTERVAL_HOURS * 60 * 60 * 1000);
  }, STARTUP_DELAY_MS);
}
