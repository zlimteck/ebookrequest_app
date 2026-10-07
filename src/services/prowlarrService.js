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

// Aplatit l'arbre de catégories Torznab/Newznab (chaque catégorie peut avoir
// des sous-catégories, ex. Books (7000) > Ebook (7020), Comics (7030)) en une
// liste plate — plus simple à afficher comme cases à cocher côté admin.
function flattenCategories(categories) {
  const flat = [];
  for (const cat of categories || []) {
    flat.push({ id: cat.id, name: cat.name });
    for (const sub of cat.subCategories || []) {
      flat.push({ id: sub.id, name: `${cat.name} / ${sub.name}` });
    }
  }
  return flat;
}

/**
 * Liste les indexeurs configurés dans Prowlarr, avec leurs catégories
 * disponibles (pour la sélection admin) et celles actuellement retenues
 * (ConnectorSettings.prowlarrIndexerCategories, vide = toutes par défaut).
 * Simplifié : seuls les champs utiles à l'admin (pas la config détaillée).
 */
export async function fetchProwlarrIndexers() {
  const [data, config] = await Promise.all([
    prowlarrGet('/api/v1/indexer'),
    getProwlarrConfig(),
  ]);
  if (!Array.isArray(data)) return [];
  const savedCategories = config.prowlarrIndexerCategories || {};
  const savedSearchEnabled = config.prowlarrIndexerSearchEnabled || {};
  return data.map(i => {
    const availableCategories = flattenCategories(i.capabilities?.categories);
    return {
      id: i.id,
      name: i.name,
      protocol: i.protocol, // 'torrent' | 'usenet'
      enabled: !!i.enable, // état du toggle Prowlarr lui-même (jamais modifié par nous)
      priority: i.priority ?? null,
      availableCategories,
      selectedCategories: savedCategories[i.id] || [],
      // Activation pour la recherche EbookRequest, indépendante du toggle Prowlarr —
      // absent = activé par défaut.
      searchEnabled: savedSearchEnabled[i.id] !== false,
    };
  });
}

/**
 * Sauvegarde la sélection de catégories pour un indexeur donné. Liste vide =
 * reset au défaut (toutes les catégories de l'indexeur).
 */
export async function saveIndexerCategorySelection(indexerId, categoryIds) {
  const config = await getProwlarrConfig();
  const current = { ...(config.prowlarrIndexerCategories || {}) };
  if (Array.isArray(categoryIds) && categoryIds.length > 0) {
    current[indexerId] = categoryIds;
  } else {
    delete current[indexerId];
  }
  await ConnectorSettings.findOneAndUpdate(
    { service: 'prowlarr' },
    { prowlarrIndexerCategories: current },
    { upsert: true, runValidators: true }
  );
  return current[indexerId] || [];
}

/**
 * Active/désactive un indexeur pour la recherche EbookRequest, sans toucher à
 * son toggle "enable" côté Prowlarr. `enabled: true` revient au défaut (entrée
 * supprimée) ; `enabled: false` le désactive explicitement.
 */
export async function saveIndexerSearchEnabled(indexerId, enabled) {
  const config = await getProwlarrConfig();
  const current = { ...(config.prowlarrIndexerSearchEnabled || {}) };
  if (enabled === false) {
    current[indexerId] = false;
  } else {
    delete current[indexerId];
  }
  await ConnectorSettings.findOneAndUpdate(
    { service: 'prowlarr' },
    { prowlarrIndexerSearchEnabled: current },
    { upsert: true, runValidators: true }
  );
  return current[indexerId] !== false;
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
