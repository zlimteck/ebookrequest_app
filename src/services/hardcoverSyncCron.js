import User from '../models/User.js';
import ReadingList from '../models/ReadingList.js';
import { syncReadingEntryToHardcover } from './hardcoverSyncService.js';
import { syncUserAuthorFollows } from './hardcoverAuthorSyncService.js';

// Filet de sécurité quotidien : la synchro se déclenche déjà immédiatement à l'ajout
// d'un livre (manuel ou via demande complétée) et à chaque changement de statut/note
// (voir reading.js et bookRequestController.js). Ce cron ne fait que rattraper les cas
// résiduels (échec transitoire, entrée modifiée directement en DB, etc.) sans retraiter
// ce qui n'a pas changé depuis la dernière tentative.
const INTERVAL_HOURS = 24;
const STARTUP_DELAY_MS = 10 * 60 * 1000; // décalé de 10 min au démarrage, pour ne pas concurrencer le cron Valentine/Anna's Archive qui tourne déjà au lancement
const DELAY_BETWEEN_BOOKS_MS = 1200; // reste largement sous les 60 req/min de Hardcover (en plus de l'espacement par appel dans hardcoverSyncService)

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// force=true (déclenchement manuel) : retente aussi les livres en erreur, même sans
// modification depuis — sinon un livre resté en échec ne serait jamais retenté tant
// que son statut/note ne change pas.
export async function syncUserLibrary(user, { force = false } = {}) {
  const orConditions = [
    { 'hardcoverSync.syncedAt': null },
    { $expr: { $gt: ['$updatedAt', '$hardcoverSync.syncedAt'] } },
  ];
  if (force) orConditions.push({ 'hardcoverSync.status': 'error' });

  const entries = await ReadingList.find({ userId: user._id, $or: orConditions });

  if (entries.length === 0) return { count: 0 };
  console.log(`[HardcoverSyncCron] ${entries.length} livre(s) à synchroniser pour ${user.username || user._id}`);

  for (const entry of entries) {
    await syncReadingEntryToHardcover(user._id, entry);
    await sleep(DELAY_BETWEEN_BOOKS_MS);
  }
  return { count: entries.length };
}

async function runHardcoverSyncCron() {
  try {
    const users = await User.find({ 'hardcover.enabled': true, 'hardcover.apiKey': { $ne: '' } })
      .select('_id username hardcover');
    for (const user of users) {
      await syncUserLibrary(user).catch(err => {
        console.warn(`[HardcoverSyncCron] Échec pour ${user.username || user._id}:`, err.message);
      });
      await syncUserAuthorFollows(user).catch(err => {
        console.warn(`[HardcoverSyncCron] Échec suivi d'auteurs pour ${user.username || user._id}:`, err.message);
      });
    }
  } catch (err) {
    console.error('[HardcoverSyncCron] Erreur:', err.message);
  }
}

let cronIntervalId = null;
let startupTimeoutId = null;

export function startHardcoverSyncCron() {
  if (cronIntervalId) clearInterval(cronIntervalId);
  if (startupTimeoutId) clearTimeout(startupTimeoutId);

  startupTimeoutId = setTimeout(() => {
    runHardcoverSyncCron(); // premier passage, décalé au démarrage
    cronIntervalId = setInterval(runHardcoverSyncCron, INTERVAL_HOURS * 60 * 60 * 1000);
  }, STARTUP_DELAY_MS);
}
