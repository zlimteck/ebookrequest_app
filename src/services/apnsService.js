import apn from '@parse/node-apn';
import axios from 'axios';
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

// Résout la config APNs (DB si activée, sinon repli .env pour le mode direct — le mode
// relais n'a pas d'équivalent .env, réglage admin uniquement) et construit le provider
// local correspondant (mode direct). DB prioritaire une fois qu'un admin a configuré/
// activé le service depuis Réglages — même logique que getEmailContext()/getProxyConfig().
async function getApnsContext() {
  if (cache.expiresAt > Date.now()) return cache.value;

  let cfg = {
    mode: 'direct',
    keyP8: process.env.APNS_KEY_P8 || '',
    keyId: process.env.APNS_KEY_ID || '',
    teamId: process.env.APNS_TEAM_ID || '',
    bundleId: process.env.APNS_BUNDLE_ID || 'com.ebookrequest.ios.full',
    production: process.env.APNS_PRODUCTION !== 'false',
    relayUrl: '',
    relayToken: '',
  };

  try {
    const doc = await ConnectorSettings.findOne({ service: 'apns' }).lean();
    if (doc?.enabled) {
      const mode = doc.apnsMode === 'relay' ? 'relay' : 'direct';
      const secret = doc.apiKey ? (decrypt(doc.apiKey) ?? doc.apiKey) : '';
      const relayToken = doc.apnsRelayToken ? (decrypt(doc.apnsRelayToken) ?? doc.apnsRelayToken) : '';
      cfg = {
        mode,
        keyP8: secret || cfg.keyP8,
        keyId: doc.apnsKeyId || cfg.keyId,
        teamId: doc.apnsTeamId || cfg.teamId,
        bundleId: doc.apnsBundleId || cfg.bundleId,
        production: doc.apnsProduction ?? cfg.production,
        relayUrl: (doc.apnsRelayUrl || '').replace(/\/$/, ''),
        relayToken,
      };
    }
  } catch {
    // MongoDB indisponible → repli .env (mode direct uniquement)
  }

  const context = {
    cfg,
    provider: cfg.mode === 'direct' ? buildProvider(cfg) : null,
  };
  cache = { value: context, expiresAt: Date.now() + CACHE_TTL_MS };
  return context;
}

export async function isApnsConfigured() {
  const { cfg, provider } = await getApnsContext();
  if (cfg.mode === 'relay') return !!(cfg.relayUrl && cfg.relayToken);
  return provider !== null;
}

// Envoie via le relais externe (projet ebookrequest_apns) — ce serveur détient la vraie
// clé Apple, cette instance ne lui transmet que les jetons d'appareil et le contenu de
// la notification. Jamais de throw vers l'appelant : mêmes garanties de robustesse que
// l'envoi direct (une panne réseau du relais ne doit jamais faire échouer sendApnsToUser).
async function sendViaRelay(cfg, tokens, payload) {
  try {
    const res = await axios.post(`${cfg.relayUrl}/send`, {
      deviceTokens: tokens,
      title: payload.title || 'EbookRequest',
      body: payload.body || '',
      url: payload.url || '/',
    }, {
      headers: { Authorization: `Bearer ${cfg.relayToken}` },
      timeout: 8000,
    });

    const invalidTokens = res.data?.invalidTokens || [];
    if (invalidTokens.length) {
      console.warn(`[APNs][relais] ${invalidTokens.length} jeton(s) invalide(s) signalé(s), suppression.`);
      await DeviceToken.deleteMany({ token: { $in: invalidTokens } });
    }
  } catch (err) {
    console.error('[APNs][relais] Erreur envoi:', err.response?.data?.error || err.message);
  }
}

/**
 * Envoie une notification push native (APNs) à tous les appareils iOS d'un utilisateur —
 * en direct (clé Apple propre à cette instance) ou via un relais externe, selon la config.
 * @param {string} userId
 * @param {object} payload  { title, body, url }
 */
export const sendApnsToUser = async (userId, payload) => {
  const { provider, cfg } = await getApnsContext();
  if (cfg.mode === 'relay' ? !(cfg.relayUrl && cfg.relayToken) : !provider) return;

  let deviceTokens;
  try {
    deviceTokens = await DeviceToken.find({ user: userId });
  } catch (err) {
    console.error('[APNs] Erreur récupération device tokens:', err);
    return;
  }
  if (!deviceTokens.length) return;

  if (cfg.mode === 'relay') {
    await sendViaRelay(cfg, deviceTokens.map(d => d.token), payload);
    return;
  }

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
