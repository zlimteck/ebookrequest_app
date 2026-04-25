import axios from 'axios';
import ConnectorSettings from '../models/ConnectorSettings.js';

async function getConfig() {
  const doc = await ConnectorSettings.findOne({ service: 'mylar3' }).lean();
  return doc || { enabled: false, url: '', apiKey: '', comicVineApiKey: '' };
}

async function callMylarAPI(url, apiKey, params) {
  const res = await axios.get(`${url.replace(/\/$/, '')}/api`, {
    params: { apikey: apiKey, ...params },
    timeout: 10000,
  });
  return res.data;
}

async function searchComicVine(comicVineApiKey, query) {
  const res = await axios.get('https://comicvine.gamespot.com/api/search/', {
    params: {
      api_key: comicVineApiKey,
      format: 'json',
      resources: 'volume',
      query,
      field_list: 'id,name,publisher,count_of_issues,image',
      limit: 10,
    },
    headers: { 'User-Agent': 'EbookRequest/1.0' },
    timeout: 10000,
  });
  return res.data?.results || [];
}

/**
 * Teste la connexion à Mylar3.
 */
export async function testConnectionMylar(url, apiKey) {
  const data = await callMylarAPI(url, apiKey, { cmd: 'getIndex' });
  if (data?.success === false) {
    throw new Error(data?.error?.message || 'Clé API invalide ou accès refusé');
  }
  return data;
}

/**
 * Envoie un comic/manga à Mylar3 via ComicVine.
 * Flux : ComicVine search → addComic avec l'ID ComicVine.
 */
export async function addBookToMylar3(title, author) {
  try {
    const config = await getConfig();
    if (!config.enabled || !config.url || !config.apiKey) return;
    if (!config.comicVineApiKey) {
      console.log('[Mylar3] Clé API ComicVine manquante, skip.');
      return;
    }

    // Nettoyer le titre (enlever "tome X", sous-titres…)
    const cleanTitle = title
      .replace(/\s*[-–—:]\s+.*/u, '')
      .replace(/\s*tome\s+\d+.*/i, '')
      .replace(/\s*vol\.?\s+\d+.*/i, '')
      .replace(/\s*\(.*\)\s*/g, '')
      .trim();

    const queries = [
      `${cleanTitle} ${author}`.trim(),
      cleanTitle,
    ];

    let volume = null;

    for (const q of queries) {
      const results = await searchComicVine(config.comicVineApiKey, q);
      if (results.length) {
        volume = results.find(v => v.name?.toLowerCase() === cleanTitle.toLowerCase()) || results[0];
        break;
      }
    }

    if (!volume) {
      console.log(`[Mylar3] Aucun résultat ComicVine pour "${title}"`);
      return;
    }

    const addData = await callMylarAPI(config.url, config.apiKey, {
      cmd: 'addComic',
      id: volume.id,
    });

    if (addData?.success !== false) {
      console.log(`[Mylar3] ✓ "${volume.name}" ajouté (ComicVine ID: ${volume.id})`);
    } else {
      console.log(`[Mylar3] addComic réponse inattendue:`, JSON.stringify(addData));
    }
  } catch (err) {
    console.error('[Mylar3] Erreur (non bloquante):', err.message);
  }
}