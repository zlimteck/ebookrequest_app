import BookRequest from '../models/BookRequest.js';
import ConnectorSettings from '../models/ConnectorSettings.js';
import { downloadFromValentine } from './valentineService.js';

const INTERVAL_HOURS = 6;
const DELAY_BETWEEN_MS = 3000; // 3s entre chaque requête pour ne pas spammer

let nextScanAt = null;

export function getNextScanTime() {
  return nextScanAt;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runValentineCron() {
  try {
    const config = await ConnectorSettings.findOne({ service: 'valentine' }).lean();
    if (!config?.enabled || !config?.username || !config?.password) return;

    const pending = await BookRequest.find({ status: 'pending' }).lean();
    if (!pending.length) return;

    console.log(`[Valentine Cron] ${pending.length} demande(s) en attente à vérifier…`);

    for (const req of pending) {
      await downloadFromValentine(req.title, req.author, req._id.toString(), req.category || 'ebook');
      await sleep(DELAY_BETWEEN_MS);
    }

    console.log('[Valentine Cron] Vérification terminée.');
  } catch (err) {
    console.error('[Valentine Cron] Erreur:', err.message);
  } finally {
    // Mettre à jour l'heure du prochain scan après chaque passage
    nextScanAt = new Date(Date.now() + INTERVAL_HOURS * 60 * 60 * 1000);
  }
}

export function startValentineCron() {
  const intervalMs = INTERVAL_HOURS * 60 * 60 * 1000;

  // Premier passage 1 minute après le démarrage
  const firstDelay = 60 * 1000;
  nextScanAt = new Date(Date.now() + firstDelay);

  setTimeout(() => {
    runValentineCron();
    setInterval(runValentineCron, intervalMs);
  }, firstDelay);

  console.log(`[Valentine Cron] Planifié toutes les ${INTERVAL_HOURS}h.`);
}