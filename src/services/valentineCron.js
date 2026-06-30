import BookRequest from '../models/BookRequest.js';
import ConnectorSettings from '../models/ConnectorSettings.js';
import { downloadWithFallback } from './connectorOrchestrator.js';

function isPublishedInFuture(dateStr) {
  if (!dateStr) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const parts = dateStr.split('-');
  let d;
  if (parts.length === 1) d = new Date(parseInt(parts[0]), 0, 1);
  else if (parts.length === 2) d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1);
  else d = new Date(dateStr);
  return !isNaN(d.getTime()) && d > today;
}

const DELAY_BETWEEN_MS = 60000; // 60s entre chaque livre — évite le rate-limit Valentine / Anna's Archive

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
      if (isPublishedInFuture(req.publishedDate)) {
        console.log(`[Connecteurs Cron] "${req.title}" ignoré — date de sortie future : ${req.publishedDate}`);
        continue;
      }
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