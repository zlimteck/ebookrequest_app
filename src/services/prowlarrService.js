import axios from 'axios';
import ConnectorSettings from '../models/ConnectorSettings.js';
import { encrypt, decrypt } from './cryptoService.js';

// Prowlarr : agrégateur d'indexeurs torrent/NZB, API REST propre (header
// X-Api-Key), pas de scraping. Ce module ne fait pour l'instant que la
// connexion (config + liste indexeurs/clients de téléchargement) — la
// recherche et le suivi de téléchargement viendront dans une étape
// ultérieure (voir issue roadmap #42).

const TIMEOUT = 10000;

export async function getProwlarrConfig() {
  const doc = await ConnectorSettings.findOne({ service: 'prowlarr' }).lean();
  return doc || { service: 'prowlarr', enabled: false, url: '', apiKey: '' };
}

export async function saveProwlarrConfig({ enabled, url, apiKey, _hasApiKey }) {
  const update = { enabled: !!enabled, url: url?.trim().replace(/\/$/, '') || '' };
  if (apiKey && apiKey !== '••••••••') update.apiKey = encrypt(apiKey);
  if (!apiKey && !_hasApiKey) update.apiKey = '';

  return ConnectorSettings.findOneAndUpdate(
    { service: 'prowlarr' },
    update,
    { upsert: true, new: true, runValidators: true }
  );
}

async function prowlarrGet(path) {
  const config = await getProwlarrConfig();
  if (!config.enabled) throw new Error('Connecteur Prowlarr désactivé');
  if (!config.url) throw new Error('URL Prowlarr non configurée');
  if (!config.apiKey) throw new Error('Clé API Prowlarr non configurée');

  const apiKey = decrypt(config.apiKey) ?? config.apiKey;
  const res = await axios.get(`${config.url}${path}`, {
    headers: { 'X-Api-Key': apiKey },
    timeout: TIMEOUT,
    validateStatus: () => true,
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error('Clé API Prowlarr invalide');
  }
  if (res.status !== 200) {
    throw new Error(`Prowlarr a répondu HTTP ${res.status}`);
  }
  return res.data;
}

/**
 * Vérifie la joignabilité + la validité de la clé API.
 * Retourne { ok, version }.
 */
export async function pingProwlarr() {
  const data = await prowlarrGet('/api/v1/system/status');
  return { ok: true, version: data?.version || null };
}

/**
 * Liste les indexeurs configurés dans Prowlarr.
 * Simplifié : seuls les champs utiles à l'admin (pas la config détaillée).
 */
export async function fetchProwlarrIndexers() {
  const data = await prowlarrGet('/api/v1/indexer');
  if (!Array.isArray(data)) return [];
  return data.map(i => ({
    id: i.id,
    name: i.name,
    protocol: i.protocol, // 'torrent' | 'usenet'
    enabled: !!i.enable,
    priority: i.priority ?? null,
  }));
}

/**
 * Liste les clients de téléchargement (qBittorrent, SABnzbd, etc.) configurés
 * dans Prowlarr.
 */
export async function fetchProwlarrDownloadClients() {
  const data = await prowlarrGet('/api/v1/downloadclient');
  if (!Array.isArray(data)) return [];
  return data.map(c => ({
    id: c.id,
    name: c.name,
    implementation: c.implementation, // ex: 'QBittorrent', 'Sabnzbd'
    protocol: c.protocol,
    enabled: !!c.enable,
  }));
}
