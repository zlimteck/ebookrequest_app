import User from '../models/User.js';
import ConnectorSettings from '../models/ConnectorSettings.js';
import appriseService from './appriseService.js';
import { sendProviderIssueToAdminsEmail } from './emailService.js';
import { sendPushToUser } from './webPushService.js';
import { getGoogleBooksApiKey, isGoogleBooksSearchEnabled } from './googleBooksConfig.js';
import { getHardcoverApiKey } from './hardcoverConfig.js';
import axios from 'axios';

// Filet de sécurité : détecte deux situations sur les providers de recherche (Google
// Books / Hardcover) et alerte les admins (email + Apprise) — pas de notification à
// chaque cron si le problème persiste, cooldown de 24h par service via
// ConnectorSettings.lastProviderIssueAlertAt.
const INTERVAL_HOURS = 6;
const STARTUP_DELAY_MS = 15 * 60 * 1000; // décalé pour ne pas concurrencer les autres crons au démarrage
const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const KEY_EXPIRY_WARNING_DAYS = 335; // ~1 mois avant l'expiration à 1 an

async function notifyAdminsProviderIssue(serviceName, message) {
  try {
    const emailDoc = await ConnectorSettings.findOne({ service: 'email' }).lean();
    const emailEnabled = emailDoc?.emailEnabled !== false;
    const notifyOn = emailDoc?.notifyOnProviderIssue !== false;

    const tasks = [];
    const admins = await User.find({ role: 'admin' }).select('email username emailVerified _id');
    if (emailEnabled && notifyOn) {
      for (const admin of admins) {
        tasks.push(sendProviderIssueToAdminsEmail(admin, serviceName, message));
      }
    }
    for (const admin of admins) {
      tasks.push(sendPushToUser(admin._id, {
        title: 'Problème fournisseur',
        body: `${serviceName} : ${message}`,
        url: '/admin',
      }));
    }
    tasks.push(appriseService.notifyProviderIssue(serviceName, message).catch(() => {}));
    await Promise.allSettled(tasks);
    console.log(`[ProviderHealthCron] Admins alertés — ${serviceName}: ${message}`);
  } catch (e) {
    console.error('[ProviderHealthCron] Erreur notification admin:', e.message);
  }
}

// N'alerte que si aucune alerte pour ce service n'a été envoyée dans les dernières 24h
// (bypass avec force=true, pour un test manuel).
async function maybeAlert(service, serviceName, message, force = false) {
  if (!force) {
    const doc = await ConnectorSettings.findOne({ service }).lean();
    const lastAlert = doc?.lastProviderIssueAlertAt;
    if (lastAlert && Date.now() - new Date(lastAlert).getTime() < ALERT_COOLDOWN_MS) return;
  }

  await notifyAdminsProviderIssue(serviceName, message);
  // timestamps: false — `updatedAt` sert de proxy pour "date d'enregistrement de la clé"
  // côté admin Hardcover (_keyUpdatedAt) ; le laisser bouger ici retarderait indéfiniment
  // l'alerte d'expiration à chaque cycle de dédup.
  await ConnectorSettings.updateOne(
    { service },
    { lastProviderIssueAlertAt: new Date() },
    { upsert: true, timestamps: false }
  );
}

async function checkGoogleBooksIssue(force = false) {
  if (!(await isGoogleBooksSearchEnabled())) return;
  const apiKey = await getGoogleBooksApiKey();
  if (!apiKey) return; // activé mais pas de clé du tout : signalé ailleurs (notification "clé manquante" déjà existante)

  try {
    const res = await axios.get('https://www.googleapis.com/books/v1/volumes', {
      params: { q: 'test', maxResults: 1, key: apiKey },
      timeout: 8000,
      validateStatus: () => true,
    });
    if (res.status !== 200) {
      await maybeAlert('googleBooks', 'Google Books',
        `Le service est activé mais les appels échouent (HTTP ${res.status}). La recherche bascule sur Hardcover/Open Library en attendant.`, force);
    }
  } catch (err) {
    await maybeAlert('googleBooks', 'Google Books',
      `Le service est activé mais injoignable (${err.code || err.message}). La recherche bascule sur Hardcover/Open Library en attendant.`, force);
  }
}

async function checkHardcoverIssue(force = false) {
  const doc = await ConnectorSettings.findOne({ service: 'hardcover' }).lean();
  if (!doc?.enabled || !doc?.apiKey) return;

  const apiKey = await getHardcoverApiKey();
  if (!apiKey) return;

  try {
    const res = await axios.post('https://api.hardcover.app/v1/graphql', { query: '{ me { id } }' }, {
      timeout: 8000,
      validateStatus: () => true,
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`,
      },
    });
    if (res.status !== 200 || res.data?.errors) {
      await maybeAlert('hardcover', 'Hardcover',
        `Le service est activé mais les appels échouent (clé invalide ou expirée ?). La recherche bascule sur Open Library en attendant.`, force);
      return;
    }
  } catch (err) {
    await maybeAlert('hardcover', 'Hardcover',
      `Le service est activé mais injoignable (${err.code || err.message}). La recherche bascule sur Open Library en attendant.`, force);
    return;
  }

  // Clé fonctionnelle mais proche de son expiration (1 an, cf. docs.hardcover.app)
  if (doc.updatedAt) {
    const ageDays = (Date.now() - new Date(doc.updatedAt).getTime()) / (24 * 60 * 60 * 1000);
    if (ageDays >= KEY_EXPIRY_WARNING_DAYS) {
      await maybeAlert('hardcover', 'Hardcover',
        `La clé API approche de son expiration (1 an, renouvelée chaque 1er janvier) — pensez à la renouveler sur hardcover.app.`, force);
    }
  }
}

export async function runProviderHealthCron(force = false) {
  try {
    await checkGoogleBooksIssue(force);
    await checkHardcoverIssue(force);
  } catch (e) {
    console.error('[ProviderHealthCron] Erreur:', e.message);
  }
}

let cronIntervalId = null;
let startupTimeoutId = null;

export function startProviderHealthCron() {
  if (cronIntervalId) clearInterval(cronIntervalId);
  if (startupTimeoutId) clearTimeout(startupTimeoutId);

  startupTimeoutId = setTimeout(() => {
    runProviderHealthCron();
    cronIntervalId = setInterval(runProviderHealthCron, INTERVAL_HOURS * 60 * 60 * 1000);
  }, STARTUP_DELAY_MS);
}
