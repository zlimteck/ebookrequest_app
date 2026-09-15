import apn from '@parse/node-apn';
import ConnectorSettings from '../models/ConnectorSettings.js';
import DeviceToken from '../models/DeviceToken.js';
import { decrypt } from './cryptoService.js';

// Config + provider résolus une seule fois puis mis en cache 60s, même pattern que
// emailConfig.js/proxyConfig.js — évite de recréer une connexion HTTP/2 APNs (coûteux)
// à chaque envoi, tout en captant un changement de config admin en moins d'une minute.
const CACHE_TTL_MS = 60 * 1000;
let cache = { value: null, expiresAt: 0 };

export function invalidateApnsConfigCache() {
  cache = { value: null, expiresAt: 0 };
}

function buildProvider(cfg) {
  if (!cfg.keyP8 || !cfg.keyId || !cfg.teamId) return null;
  try {
    return new apn.Provider({
      token: {
        // Autorise soit la clé brute (avec vrais retours à la ligne), soit collée sur une
        // seule ligne avec des "\n" littéraux (cas courant en variable d'environnement) —
        // ce second format doit être décodé avant d'être passé à node-apn.
        key: cfg.keyP8.includes('\\n') ? cfg.keyP8.replace(/\\n/g, '\n') : cfg.keyP8,
        keyId: cfg.keyId,
        teamId: cfg.teamId,
      },
      production: cfg.production,
    });
  } catch (err) {
    console.error('[APNs] Échec d\'initialisation du provider:', err.message);
    return null;
  }
}

// Résout la config APNs (DB si activée, sinon repli .env) et construit le provider
// correspondant. DB prioritaire une fois qu'un admin a configuré/activé le service
// depuis Réglages — même logique que getEmailContext()/getProxyConfig().
async function getApnsContext() {
  if (cache.expiresAt > Date.now()) return cache.value;

  let cfg = {
    keyP8: process.env.APNS_KEY_P8 || '',
    keyId: process.env.APNS_KEY_ID || '',
    teamId: process.env.APNS_TEAM_ID || '',
    bundleId: process.env.APNS_BUNDLE_ID || 'com.ebookrequest.ios.full',
    production: process.env.APNS_PRODUCTION !== 'false',
  };

  try {
    const doc = await ConnectorSettings.findOne({ service: 'apns' }).lean();
    if (doc?.enabled) {
      const secret = doc.apiKey ? (decrypt(doc.apiKey) ?? doc.apiKey) : '';
      cfg = {
        keyP8: secret || cfg.keyP8,
        keyId: doc.apnsKeyId || cfg.keyId,
        teamId: doc.apnsTeamId || cfg.teamId,
        bundleId: doc.apnsBundleId || cfg.bundleId,
        production: doc.apnsProduction ?? cfg.production,
      };
    }
  } catch {
    // MongoDB indisponible → repli .env
  }

  const context = { cfg, provider: buildProvider(cfg) };
  cache = { value: context, expiresAt: Date.now() + CACHE_TTL_MS };
  return context;
}

export async function isApnsConfigured() {
  const { provider } = await getApnsContext();
  return provider !== null;
}

/**
 * Envoie une notification push native (APNs) à tous les appareils iOS d'un utilisateur.
 * @param {string} userId
 * @param {object} payload  { title, body, url }
 */
export const sendApnsToUser = async (userId, payload) => {
  const { provider, cfg } = await getApnsContext();
  if (!provider) return;

  let deviceTokens;
  try {
    deviceTokens = await DeviceToken.find({ user: userId });
  } catch (err) {
    console.error('[APNs] Erreur récupération device tokens:', err);
    return;
  }
  if (!deviceTokens.length) return;

  const notification = new apn.Notification();
  notification.topic = cfg.bundleId;
  notification.alert = { title: payload.title || 'EbookRequest', body: payload.body || '' };
  notification.sound = 'default';
  notification.payload = { url: payload.url || '/' };
  notification.expiry = Math.floor(Date.now() / 1000) + 3600; // Abandon après 1h si l'appareil est hors-ligne

  const result = await provider.send(notification, deviceTokens.map(d => d.token));

  // Nettoyer les jetons qu'Apple signale comme définitivement invalides (app désinstallée,
  // jeton périmé/remplacé) — les autres échecs (réseau, throttling) ne sont que loggés.
  const toDelete = [];
  for (const failure of result.failed) {
    const reason = failure.response?.reason;
    if (failure.status === '410' || reason === 'Unregistered' || reason === 'BadDeviceToken') {
      toDelete.push(failure.device);
      // `BadDeviceToken` est très souvent un mismatch d'environnement (token sandbox d'un
      // build Xcode debug envoyé alors qu'APNS_PRODUCTION=true côté serveur, ou l'inverse)
      // plutôt qu'un jeton réellement périmé — logger même ce cas évite un échec totalement
      // silencieux, indiscernable d'un envoi réussi depuis les logs.
      console.warn(`[APNs] Jeton invalide supprimé (${reason || failure.status}) pour ${failure.device.slice(0, 12)}...`);
    } else {
      console.error(`[APNs] Erreur envoi à ${failure.device}:`, reason || failure.error?.message);
    }
  }
  if (toDelete.length) {
    await DeviceToken.deleteMany({ token: { $in: toDelete } });
  }
};
