import BookRequest from '../models/BookRequest.js';
import ConnectorSettings from '../models/ConnectorSettings.js';
import { downloadWithFallback } from './connectorOrchestrator.js';

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
    // Le cron tourne si Valentine OU Anna's Archive est activé
    const [valentineConfig, annasConfig] = await Promise.all([
      ConnectorSettings.findOne({ service: 'valentine' }).lean(),
      ConnectorSettings.findOne({ service: 'annasarchive' }).lean(),
    ]);

    const valentineActive = valentineConfig?.enabled && valentineConfig?.username && valentineConfig?.password;
    const annasActive = annasConfig?.enabled;

    if (!valentineActive && !annasActive) return;

    const pending = await BookRequest.find({ status: 'pending' }).lean();
    if (!pending.length) return;

    console.log(`[Connecteurs Cron] ${pending.length} demande(s) en attente à vérifier…`);

    for (const req of pending) {
      await downloadWithFallback(req.title, req.author, req._id.toString(), req.category || 'ebook');
      await sleep(DELAY_BETWEEN_MS);
    }

    console.log('[Connecteurs Cron] Vérification terminée.');
  } catch (err) {
    console.error('[Connecteurs Cron] Erreur:', err.message);
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