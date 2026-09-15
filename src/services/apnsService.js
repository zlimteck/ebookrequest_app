import apn from '@parse/node-apn';
import DeviceToken from '../models/DeviceToken.js';

// Provider créé une seule fois au démarrage — `apn.Provider` maintient sa propre connexion
// HTTP/2 persistante vers APNs, la recréer à chaque envoi serait à la fois plus lent et
// épuiserait le quota de connexions côté Apple.
let provider = null;

function buildProvider() {
  const { APNS_KEY_P8, APNS_KEY_ID, APNS_TEAM_ID } = process.env;
  if (!APNS_KEY_P8 || !APNS_KEY_ID || !APNS_TEAM_ID) return null;

  try {
    return new apn.Provider({
      token: {
        // Autorise soit la clé brute (avec vrais retours à la ligne), soit collée sur une
        // seule ligne avec des "\n" littéraux (cas courant en variable d'environnement) —
        // ce second format doit être décodé avant d'être passé à node-apn.
        key: APNS_KEY_P8.includes('\\n') ? APNS_KEY_P8.replace(/\\n/g, '\n') : APNS_KEY_P8,
        keyId: APNS_KEY_ID,
        teamId: APNS_TEAM_ID,
      },
      production: process.env.APNS_PRODUCTION !== 'false',
    });
  } catch (err) {
    console.error('[APNs] Échec d\'initialisation du provider:', err.message);
    return null;
  }
}

function getProvider() {
  if (provider === null) provider = buildProvider();
  return provider;
}

export function isApnsConfigured() {
  return getProvider() !== null;
}

/**
 * Envoie une notification push native (APNs) à tous les appareils iOS d'un utilisateur.
 * @param {string} userId
 * @param {object} payload  { title, body, url }
 */
export const sendApnsToUser = async (userId, payload) => {
  const activeProvider = getProvider();
  if (!activeProvider) return;

  let deviceTokens;
  try {
    deviceTokens = await DeviceToken.find({ user: userId });
  } catch (err) {
    console.error('[APNs] Erreur récupération device tokens:', err);
    return;
  }
  if (!deviceTokens.length) return;

  const notification = new apn.Notification();
  notification.topic = process.env.APNS_BUNDLE_ID || 'com.ebookrequest.ios.full';
  notification.alert = { title: payload.title || 'EbookRequest', body: payload.body || '' };
  notification.sound = 'default';
  notification.payload = { url: payload.url || '/' };
  notification.expiry = Math.floor(Date.now() / 1000) + 3600; // Abandon après 1h si l'appareil est hors-ligne

  const result = await activeProvider.send(notification, deviceTokens.map(d => d.token));

  // Nettoyer les jetons qu'Apple signale comme définitivement invalides (app désinstallée,
  // jeton périmé/remplacé) — les autres échecs (réseau, throttling) ne sont que loggés.
  const toDelete = [];
  for (const failure of result.failed) {
    const reason = failure.response?.reason;
    if (failure.status === '410' || reason === 'Unregistered' || reason === 'BadDeviceToken') {
      toDelete.push(failure.device);
    } else {
      console.error(`[APNs] Erreur envoi à ${failure.device}:`, reason || failure.error?.message);
    }
  }
  if (toDelete.length) {
    await DeviceToken.deleteMany({ token: { $in: toDelete } });
  }
};
