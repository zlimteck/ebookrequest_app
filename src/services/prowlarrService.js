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
 * Recherche sur les indexeurs activés pour la recherche EbookRequest
 * (searchEnabled !== false) ET actifs côté Prowlarr. Un appel par indexeur
 * (pas un seul appel multi-indexeurs) car la sélection de catégories est
 * propre à chacun, alors que l'API /search de Prowlarr applique un seul
 * jeu de catégories pour tout l'appel — pas de granularité par indexeur.
 * Recherche seulement : pas de téléchargement (voir issue roadmap #42, V1).
 */
export async function searchProwlarr(query) {
  const config = await getProwlarrConfig();
  if (!config.enabled) throw new Error('Connecteur Prowlarr désactivé');
  if (!config.url || !config.apiKey) throw new Error('Prowlarr non configuré');

  const apiKey = decrypt(config.apiKey) ?? config.apiKey;
  const indexers = await fetchProwlarrIndexers();
  const targets = indexers.filter(i => i.enabled && i.searchEnabled);
  if (targets.length === 0) return { results: [] };

  const perIndexer = await Promise.allSettled(targets.map(async idx => {
    const params = new URLSearchParams();
    params.append('query', query);
    params.append('indexerIds', idx.id);
    params.append('type', 'search');
    for (const catId of idx.selectedCategories) params.append('categories', catId);

    const res = await axios.get(`${config.url}/api/v1/search?${params.toString()}`, {
      headers: { 'X-Api-Key': apiKey },
      timeout: 20000,
      validateStatus: () => true,
    });
    if (res.status !== 200 || !Array.isArray(res.data)) return [];

    return res.data.map(r => ({
      title: r.title,
      guid: r.guid,
      indexerId: idx.id,
      indexer: idx.name,
      protocol: idx.protocol,
      size: r.size ?? null,
      seeders: r.seeders ?? null,
      publishDate: r.publishDate || null,
      // downloadUrl/magnetUrl = lien direct vers le fichier .torrent/magnet/NZB ;
      // infoUrl = lien de la fiche sur l'indexeur, pour consultation humaine.
      downloadUrl: r.downloadUrl || r.magnetUrl || null,
      infoUrl: r.infoUrl || r.guid || null,
    }));
  }));

  const results = perIndexer.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  results.sort((a, b) => new Date(b.publishDate || 0) - new Date(a.publishDate || 0));
  return { results };
}

// Extrait le hash BitTorrent d'un lien magnet (xt=urn:btih:<hash>) — seule
// façon fiable de suivre le téléchargement ensuite auprès du client torrent,
// qui identifie toujours ses torrents par ce hash, jamais par le guid Prowlarr.
function extractMagnetHash(magnetUrl) {
  const match = (magnetUrl || '').match(/xt=urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Déclenche le téléchargement d'un résultat (POST /api/v1/search avec
 * guid+indexerId, Prowlarr relaie vers le client configuré de son côté pour
 * cet indexeur). Retourne le hash à suivre ensuite auprès du client torrent
 * (voir downloadClients/) — extrait directement du lien magnet s'il y en a
 * un, sinon calculé en téléchargeant le fichier .torrent lui-même et en
 * hashant son dictionnaire "info" (seule façon fiable d'obtenir le même hash
 * que celui utilisé par les clients torrent, qui n'ont jamais connaissance
 * du guid Prowlarr).
 * Non vérifié en conditions réelles (endpoint déduit du comportement connu
 * de l'UI Prowlarr "Recherche manuelle", pas documenté explicitement).
 */
export async function grabRelease({ guid, indexerId, downloadUrl }) {
  const config = await getProwlarrConfig();
  if (!config.enabled) throw new Error('Connecteur Prowlarr désactivé');
  const apiKey = decrypt(config.apiKey) ?? config.apiKey;

  const res = await axios.post(`${config.url}/api/v1/search`, { guid, indexerId }, {
    headers: { 'X-Api-Key': apiKey },
    timeout: 20000,
    validateStatus: () => true,
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Prowlarr a refusé le téléchargement (HTTP ${res.status})`);
  }

  const magnetHash = extractMagnetHash(downloadUrl);
  if (magnetHash) return { hash: magnetHash };

  if (downloadUrl) {
    try {
      const { getInfoHashFromTorrentFile } = await import('./torrentFileUtil.js');
      const fileRes = await axios.get(downloadUrl, {
        headers: { 'X-Api-Key': apiKey },
        responseType: 'arraybuffer',
        timeout: 20000,
        validateStatus: () => true,
      });
      if (fileRes.status === 200) {
        return { hash: getInfoHashFromTorrentFile(Buffer.from(fileRes.data)) };
      }
      console.warn(`[Prowlarr] Téléchargement du .torrent pour calcul du hash échoué (HTTP ${fileRes.status})`);
    } catch (err) {
      console.warn(`[Prowlarr] Calcul du hash depuis le .torrent échoué: ${err.message}`);
    }
  }

  return { hash: null };
}

/**
 * Liste les clients de téléchargement (qBittorrent, SABnzbd, etc.) configurés
 * dans Prowlarr.
 */
// Correspondance entre le nom d'implémentation Prowlarr et notre propre
// type d'adaptateur (src/services/downloadClients/) — null si pas supporté
// (ex: SABnzbd, usenet, hors scope de ce téléchargement torrent).
const IMPLEMENTATION_TO_TYPE = {
  QBittorrent: 'qbittorrent',
  Transmission: 'transmission',
  Deluge: 'deluge',
  RTorrent: 'rtorrent',
};

export async function fetchProwlarrDownloadClients() {
  const data = await prowlarrGet('/api/v1/downloadclient');
  if (!Array.isArray(data)) return [];
  return data.map(c => {
    const fields = c.fields || [];
    const getField = (name) => fields.find(f => f.name === name)?.value;
    // Prowlarr ne renvoie JAMAIS le mot de passe via l'API (champ masqué côté
    // serveur, comme Sonarr/Radarr) — seules les infos non sensibles sont
    // exploitables pour pré-remplir notre propre config.
    const host = getField('host');
    const port = getField('port');
    const useSsl = getField('useSsl');
    const urlBase = getField('urlBase') || '';
    const suggestedUrl = host ? `${useSsl ? 'https' : 'http'}://${host}${port ? `:${port}` : ''}${urlBase}` : null;
    return {
      id: c.id,
      name: c.name,
      implementation: c.implementation, // ex: 'QBittorrent', 'Sabnzbd'
      protocol: c.protocol,
      enabled: !!c.enable,
      suggestedType: IMPLEMENTATION_TO_TYPE[c.implementation] || null,
      suggestedUrl,
      suggestedUsername: getField('username') || '',
    };
  });
}
