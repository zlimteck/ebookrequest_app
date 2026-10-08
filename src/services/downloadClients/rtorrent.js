import xmlrpc from 'xmlrpc';

// Client rTorrent/ruTorrent via XML-RPC. `config.url` doit être l'endpoint
// RPC complet tel qu'exposé (ex: pont SCGI-vers-HTTP pour rTorrent nu, ou
// https://host/rutorrent/plugins/httprpc/action.php pour ruTorrent) — pas
// une URL d'interface web classique, à renseigner par l'admin lui-même.

function createClient(config) {
  const url = new URL(config.url);
  const options = {
    host: url.hostname,
    port: url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname || '/RPC2',
    basic_auth: config.username ? { user: config.username, pass: config.password || '' } : undefined,
  };
  return url.protocol === 'https:' ? xmlrpc.createSecureClient(options) : xmlrpc.createClient(options);
}

function call(client, method, params) {
  return new Promise((resolve, reject) => {
    client.methodCall(method, params, (err, value) => err ? reject(err) : resolve(value));
  });
}

/**
 * rTorrent identifie ses torrents par leur hash en MAJUSCULES (convention
 * historique de son API XML-RPC, contrairement aux autres clients).
 */
export async function getStatus(config, hash) {
  const client = createClient(config);
  const id = hash.toUpperCase();

  let name, complete, directory;
  try {
    [name, complete, directory] = await Promise.all([
      call(client, 'd.name', [id]),
      call(client, 'd.complete', [id]),
      call(client, 'd.directory', [id]),
    ]);
  } catch (err) {
    // Torrent inconnu du client (pas encore apparu, ou hash erroné) — distinct
    // d'une vraie erreur réseau/auth, qu'on laisse remonter normalement.
    if (/not found|could not find/i.test(err.message || '')) return null;
    throw err;
  }

  let files = [];
  try {
    const paths = await call(client, 'f.multicall', [id, '', 'f.path=']);
    files = (paths || []).map(p => ({ name: Array.isArray(p) ? p[0] : p, size: null }));
  } catch {
    // Best-effort : la liste de fichiers n'est pas critique pour détecter la complétion.
  }

  return {
    completed: Number(complete) === 1,
    progress: Number(complete) === 1 ? 100 : null, // rtorrent ne donne pas de % direct par cet appel
    name,
    savePath: directory,
    files,
  };
}
