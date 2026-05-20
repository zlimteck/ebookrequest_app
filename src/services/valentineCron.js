import BookRequest from '../models/BookRequest.js';
import ConnectorSettings from '../models/ConnectorSettings.js';
import { downloadWithFallback } from './connectorOrchestrator.js';

const DELAY_BETWEEN_MS = 15000; // 15s entre chaque livre — évite le rate-limit Anna's Archive

let nextScanAt = null;
let cronIntervalId = null;

export function getNextScanTime() {
  return nextScanAt;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runValentineCron() {
  // Planifier le prochain scan dès le début — le frontend affiche immédiatement la bonne heure
  const cfg = await ConnectorSettings.findOne({ service: 'valentine' }).lean();
  const currentIntervalHours = cfg?.cronInterval || 6;
  nextScanAt = new Date(Date.now() + currentIntervalHours * 60 * 60 * 1000);

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
  }
}

export async function startValentineCron() {
  const config = await ConnectorSettings.findOne({ service: 'valentine' }).lean();
  const intervalHours = config?.cronInterval || 6;
  const intervalMs = intervalHours * 60 * 60 * 1000;
  const firstDelay = 60 * 1000;
  nextScanAt = new Date(Date.now() + firstDelay);
  setTimeout(() => {
    runValentineCron();
    cronIntervalId = setInterval(runValentineCron, intervalMs);
  }, firstDelay);
  console.log(`[Valentine Cron] Planifié toutes les ${intervalHours}h.`);
}

export function restartCronInterval(hours) {
  if (cronIntervalId) clearInterval(cronIntervalId);
  const intervalMs = hours * 60 * 60 * 1000;
  nextScanAt = new Date(Date.now() + intervalMs);
  cronIntervalId = setInterval(runValentineCron, intervalMs);
  console.log(`[Valentine Cron] Intervalle mis à jour : toutes les ${hours}h.`);
}