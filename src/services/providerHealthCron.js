import User from '../models/User.js';
import ConnectorSettings from '../models/ConnectorSettings.js';
import appriseService from './appriseService.js';
import { sendProviderIssueToAdminsEmail } from './emailService.js';
import { sendPushToUser } from './webPushService.js';
import { getGoogleBooksApiKey, isGoogleBooksSearchEnabled } from './googleBooksConfig.js';
import { getHardcoverApiKey } from './hardcoverConfig.js';
import { fetchUpcomingReleases, getUpcomingReleasesConfig } from './upcomingReleasesService.js';
import axios from 'axios';

// Filet de sécurité : détecte deux situations sur les providers de recherche (Google
// Books / Hardcover) et alerte les admins (email + Apprise) — pas de notification à
// chaque cron si le problème persiste, cooldown de 24h par service via
// ConnectorSettings.lastProviderIssueAlertAt.
const INTERVAL_HOURS = 6;
const STARTUP_DELAY_MS = 15 * 60 * 1000; // décalé pour ne pas concurrencer les autres crons au démarrage
const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

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

  // Pas d'alerte proactive basée sur l'âge de la clé : depuis le passage aux
  // clés hc_pat_, l'expiration est choisie librement par l'utilisateur à la
  // génération (plus un délai fixe d'1 an réinitialisé chaque 1er janvier),
  // donc impossible à estimer depuis l'âge seul — l'alerte réactive
  // ci-dessus (appels en échec) couvre déjà le cas d'une clé expirée.
}

// UZ n'a pas d'API clé mais un cookie de session manuel (voir
// uzService.js) — pas de login programmatique possible (hCaptcha sur
// login.php), donc contrairement à Google Books/Hardcover ce n'est pas une
// coupure de service qui se résout seule : l'admin doit recoller un cookie
// frais depuis son navigateur. Même mécanisme d'alerte/cooldown que les
// providers ci-dessus, pour ne pas le découvrir seulement en tentant une recherche.
async function checkUltimZoneIssue(force = false) {
  const doc = await ConnectorSettings.findOne({ service: 'ultimzone' }).lean();
  if (!doc?.enabled || !doc?.apiKey) return;

  try {
    const { pingUltimZone } = await import('./uzService.js');
    await pingUltimZone();
  } catch (err) {
    await maybeAlert('ultimzone', 'Ultim-Zone',
      `${err.message} — recherche indisponible tant que le cookie n'est pas renouvelé.`, force);
  }
}

// Contrairement à Google Books/Hardcover, une coupure Prowlarr touche aussi
// bien la recherche manuelle/directe que le fallback automatique et le grab
// de torrents déjà en attente — mieux vaut la détecter avant qu'un admin la
// découvre en constatant que les demandes restent bloquées.
async function checkProwlarrIssue(force = false) {
  const doc = await ConnectorSettings.findOne({ service: 'prowlarr' }).lean();
  if (!doc?.enabled || !doc?.url || !doc?.apiKey) return;

  try {
    const { pingProwlarr } = await import('./prowlarrService.js');
    await pingProwlarr();
  } catch (err) {
    await maybeAlert('prowlarr', 'Prowlarr',
      `${err.message} — recherche et téléchargement automatique indisponibles tant que l'instance n'est pas de nouveau joignable.`, force);
  }
}

// Le flux BnF (Nouveautés Éditeurs) n'a pas de clé API — rien ne prévient
// l'admin si la BnF change l'URL ou le format XML du jour au lendemain, la
// page afficherait juste "Aucune sortie à venir" silencieusement sans que
// personne ne le remarque. Un flux qui répond normalement contient toujours
// une centaine d'annonces ou plus ; zéro résultat est anormal, que ce soit
// une panne réseau ou un format qui ne correspond plus au parsing attendu.
async function checkBnfFeedIssue(force = false) {
  const config = await getUpcomingReleasesConfig();
  if (!config.enabled) return;

  try {
    const releases = await fetchUpcomingReleases();
    if (releases.length === 0) {
      await maybeAlert('upcomingReleasesBnf', 'Prochaines sorties (BnF)',
        `Le flux BnF Nouveautés Éditeurs ne renvoie plus aucune annonce — panne réseau ou changement de format côté BnF, à vérifier manuellement (nouveautes-editeurs.bnf.fr).`, force);
    }
  } catch (err) {
    await maybeAlert('upcomingReleasesBnf', 'Prochaines sorties (BnF)',
      `Le flux BnF Nouveautés Éditeurs est injoignable (${err.code || err.message}).`, force);
  }
}

export async function runProviderHealthCron(force = false) {
  try {
    await checkGoogleBooksIssue(force);
    await checkHardcoverIssue(force);
    await checkBnfFeedIssue(force);
    await checkUltimZoneIssue(force);
    await checkProwlarrIssue(force);
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
