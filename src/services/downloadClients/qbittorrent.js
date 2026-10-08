import axios from 'axios';

// Client qBittorrent via son Web API v2 (documentée, stable).
// Référence : https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)

async function login(config) {
  const params = new URLSearchParams();
  params.append('username', config.username || '');
  params.append('password', config.password || '');
  const res = await axios.post(`${config.url}/api/v2/auth/login`, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': config.url },
    timeout: 10000,
    validateStatus: () => true,
  });
  const cookie = (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  if (res.status !== 200 || !cookie) throw new Error('Authentification qBittorrent échouée');
  return cookie;
}

/**
 * Retourne l'état d'un torrent par son hash, ou null s'il n'existe pas
 * (encore) dans le client. { completed, progress (0-100), name, savePath, files }
 */
export async function getStatus(config, hash) {
  const cookie = await login(config);
  const res = await axios.get(`${config.url}/api/v2/torrents/info`, {
    params: { hashes: hash.toLowerCase() },
    headers: { Cookie: cookie },
    timeout: 10000,
  });
  const torrent = res.data?.[0];
  if (!torrent) return null;

  const filesRes = await axios.get(`${config.url}/api/v2/torrents/files`, {
    params: { hash: hash.toLowerCase() },
    headers: { Cookie: cookie },
    timeout: 10000,
  }).catch(() => ({ data: [] }));

  // États qBittorrent indiquant un torrent terminé (seeding/stalled en upload/pause après complétion).
  const DONE_STATES = ['uploading', 'stalledUP', 'pausedUP', 'queuedUP', 'forcedUP', 'checkingUP'];
  return {
    completed: DONE_STATES.includes(torrent.state) || torrent.progress >= 1,
    progress: Math.round((torrent.progress || 0) * 100),
    name: torrent.name,
    savePath: torrent.save_path,
    files: (filesRes.data || []).map(f => ({ name: f.name, size: f.size })),
  };
}
