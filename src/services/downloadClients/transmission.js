import axios from 'axios';

// Client Transmission via son RPC JSON (session CSRF obligatoire : premier
// appel sans X-Transmission-Session-Id reçoit un 409 contenant l'id à
// réutiliser pour tous les appels suivants).
// Référence : https://github.com/transmission/transmission/blob/main/docs/rpc-spec.md

async function rpcCall(config, method, args, sessionId) {
  const res = await axios.post(config.url, { method, arguments: args }, {
    auth: config.username ? { username: config.username, password: config.password || '' } : undefined,
    headers: sessionId ? { 'X-Transmission-Session-Id': sessionId } : {},
    timeout: 10000,
    validateStatus: () => true,
  });
  if (res.status === 409) {
    const freshSessionId = res.headers['x-transmission-session-id'];
    return rpcCall(config, method, args, freshSessionId);
  }
  if (res.status !== 200) throw new Error(`Transmission a répondu HTTP ${res.status}`);
  return res.data;
}

/**
 * Transmission accepte le hash (hashString) directement comme identifiant
 * dans `ids` pour torrent-get.
 */
export async function getStatus(config, hash) {
  const data = await rpcCall(config, 'torrent-get', {
    ids: [hash.toLowerCase()],
    fields: ['name', 'percentDone', 'status', 'downloadDir', 'files', 'isFinished'],
  });
  const torrent = data?.arguments?.torrents?.[0];
  if (!torrent) return null;

  return {
    completed: !!torrent.isFinished || torrent.percentDone >= 1,
    progress: Math.round((torrent.percentDone || 0) * 100),
    name: torrent.name,
    savePath: torrent.downloadDir,
    files: (torrent.files || []).map(f => ({ name: f.name, size: f.length })),
  };
}
