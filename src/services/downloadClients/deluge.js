import axios from 'axios';

// Client Deluge via son API JSON-RPC (deluge-web), authentification par mot
// de passe (pas de notion de username côté Deluge Web classique, ignoré si
// fourni), session maintenue par cookie.
// Référence : https://deluge-torrent.org/docs/current/core/rpc.html (exposé en JSON-RPC par deluge-web)

let reqId = 0;

async function rpcCall(config, cookie, method, params) {
  const res = await axios.post(config.url, { method, params, id: ++reqId }, {
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    timeout: 10000,
    validateStatus: () => true,
  });
  if (res.data?.error) throw new Error(res.data.error.message || 'Erreur Deluge');
  return res.data?.result;
}

async function login(config) {
  const res = await axios.post(config.url, { method: 'auth.login', params: [config.password || ''], id: ++reqId }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000,
    validateStatus: () => true,
  });
  const cookie = (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  if (!res.data?.result) throw new Error('Authentification Deluge échouée');
  return cookie;
}

/**
 * Deluge identifie les torrents par leur hash directement (en minuscules).
 */
export async function getStatus(config, hash) {
  const cookie = await login(config);
  const id = hash.toLowerCase();
  const status = await rpcCall(config, cookie, 'core.get_torrent_status', [
    id,
    ['name', 'progress', 'is_finished', 'save_path', 'files'],
  ]);
  if (!status || Object.keys(status).length === 0) return null;

  return {
    completed: !!status.is_finished || status.progress >= 100,
    progress: Math.round(status.progress || 0),
    name: status.name,
    savePath: status.save_path,
    files: (status.files || []).map(f => ({ name: f.path, size: f.size })),
  };
}
