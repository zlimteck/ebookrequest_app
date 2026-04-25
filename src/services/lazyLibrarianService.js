import axios from 'axios';
import ConnectorSettings from '../models/ConnectorSettings.js';

/**
 * Récupère la config LazyLibrarian depuis la base de données.
 */
async function getConfig() {
  const doc = await ConnectorSettings.findOne({ service: 'lazylibrarian' }).lean();
  return doc || { enabled: false, url: '', apiKey: '' };
}

/**
 * Appelle l'API LazyLibrarian.
 * @param {string} url - URL de base (ex: http://192.168.1.10:5299)
 * @param {string} apiKey
 * @param {object} params - paramètres additionnels (cmd, name, id…)
 */
async function callAPI(url, apiKey, params) {
  const res = await axios.get(`${url.replace(/\/$/, '')}/api`, {
    params: { apikey: apiKey, ...params },
    timeout: 10000,
  });
  return res.data;
}

/**
 * Teste la connexion à LazyLibrarian.
 * On accepte toute réponse HTTP 200 qui n'est pas un message d'erreur explicite.
 */
export async function testConnection(url, apiKey) {
  const data = await callAPI(url, apiKey, { cmd: 'getVersion' });

  // Si l'API retourne result: "error" c'est un échec explicite (clé API invalide, etc.)
  if (data?.result === 'error') {
    throw new Error(data?.message || 'Clé API invalide ou accès refusé');
  }

  // Toute autre réponse HTTP 200 est considérée comme un succès
  const version =
    data?.data?.LazyLibrarian ||
    data?.data?.version ||
    (typeof data?.data === 'string' ? data.data : null);

  return { ...data, version };
}

/**
 * Envoie un livre à LazyLibrarian après une nouvelle demande.
 * Flux : searchBook → addBook avec le premier résultat.
 * Ne bloque jamais la création de la demande (erreurs silencieuses).
 * @param {string} title
 * @param {string} author
 */
export async function addBookToLazyLibrarian(title, author) {
  try {
    const config = await getConfig();
    if (!config.enabled || !config.url || !config.apiKey) {
      console.log('[LazyLibrarian] Désactivé ou config incomplète, skip.');
      return;
    }

    // Nettoyer le titre : couper après " - ", " : ", " (" pour enlever les sous-titres marketing
    const cleanTitle = title
      .replace(/\s*[-–—:]\s+.*/u, '')
      .replace(/\s*\(.*\)\s*/g, '')
      .trim();

    const queries = [
      `${cleanTitle} ${author}`.trim(),
      cleanTitle,
      author,
    ];

    let results = null;

    for (const q of queries) {
      const res = await callAPI(config.url, config.apiKey, { cmd: 'findBook', name: q });
      const items = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
      if (items.length) { results = items; break; }
    }

    if (!results?.length) {
      console.log(`[LazyLibrarian] Aucun résultat pour "${title}" de ${author}`);
      return;
    }

    const book = results.sort((a, b) => (b.highest_fuzz || 0) - (a.highest_fuzz || 0))[0];

    // Seuil minimum pour éviter les faux positifs (coffrets, fiches de lecture…)
    if ((book.highest_fuzz || 0) < 65) {
      console.log(`[LazyLibrarian] Score trop faible (${book.highest_fuzz}) pour "${title}", skip.`);
      return;
    }

    const bookId = book.bookid || book.BookID || book.id;

    if (!bookId) {
      console.log('[LazyLibrarian] ID livre introuvable dans la réponse');
      return;
    }

    const addData = await callAPI(config.url, config.apiKey, { cmd: 'addBook', id: bookId });

    if (addData === 'OK' || addData?.result === 'success') {
      console.log(`[LazyLibrarian] ✓ "${title}" ajouté (${book.bookname})`);
      // Déclencher la recherche immédiatement
      try {
        await callAPI(config.url, config.apiKey, { cmd: 'searchBook', id: bookId });
        console.log(`[LazyLibrarian] Recherche déclenchée pour "${title}"`);
      } catch {
        // Non bloquant
      }
    } else {
      console.log(`[LazyLibrarian] addBook réponse inattendue:`, JSON.stringify(addData));
    }
  } catch (err) {
    console.error('[LazyLibrarian] Erreur (non bloquante):', err.message);
    if (err.response) {
      console.error('[LazyLibrarian] HTTP', err.response.status, JSON.stringify(err.response.data));
    }
  }
}