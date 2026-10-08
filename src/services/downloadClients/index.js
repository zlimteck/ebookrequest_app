import ConnectorSettings from '../../models/ConnectorSettings.js';
import { encrypt, decrypt } from '../cryptoService.js';
import * as qbittorrent from './qbittorrent.js';
import * as transmission from './transmission.js';
import * as deluge from './deluge.js';
import * as rtorrent from './rtorrent.js';

// Un seul adaptateur actif à la fois (type choisi dans Réglages), chacun
// exposant la même interface : getStatus(config, hash) -> { completed,
// progress, name, savePath, files } | null (torrent inconnu du client).
const ADAPTERS = { qbittorrent, transmission, deluge, rtorrent };

export async function getDownloadClientConfig() {
  const doc = await ConnectorSettings.findOne({ service: 'downloadClient' }).lean();
  return doc || { service: 'downloadClient', downloadClientType: '', fileAccessMode: 'local' };
}

export async function saveDownloadClientConfig(body) {
  const {
    downloadClientType, url, downloadClientUsername, password, _hasPassword,
    fileAccessMode, fileAccessLocalPath, fileAccessWebdavUrl, fileAccessWebdavUsername, fileAccessWebdavBasePath,
    apiKey, _hasApiKey, // apiKey réutilisé pour le mot de passe WebDAV
  } = body;

  const update = {
    downloadClientType: downloadClientType || '',
    url: url?.trim().replace(/\/$/, '') || '',
    downloadClientUsername: downloadClientUsername?.trim() || '',
    fileAccessMode: fileAccessMode === 'webdav' ? 'webdav' : 'local',
    fileAccessLocalPath: fileAccessLocalPath?.trim() || '',
    fileAccessWebdavUrl: fileAccessWebdavUrl?.trim().replace(/\/$/, '') || '',
    fileAccessWebdavUsername: fileAccessWebdavUsername?.trim() || '',
    fileAccessWebdavBasePath: fileAccessWebdavBasePath?.trim() || '',
  };
  if (password && password !== '••••••••') update.password = encrypt(password);
  if (!password && !_hasPassword) update.password = '';
  if (apiKey && apiKey !== '••••••••') update.apiKey = encrypt(apiKey);
  if (!apiKey && !_hasApiKey) update.apiKey = '';

  return ConnectorSettings.findOneAndUpdate(
    { service: 'downloadClient' }, update, { upsert: true, new: true, runValidators: true }
  );
}

/**
 * État d'un téléchargement par hash de torrent, via le client configuré.
 * Retourne null si le client n'est pas configuré ou si le torrent n'y est
 * pas (encore) connu.
 */
export async function getTorrentStatus(hash) {
  const config = await getDownloadClientConfig();
  const adapter = ADAPTERS[config.downloadClientType];
  if (!adapter) throw new Error('Client de téléchargement non configuré');
  if (!config.url) throw new Error('URL du client de téléchargement manquante');

  return adapter.getStatus({
    url: config.url,
    username: config.downloadClientUsername,
    password: decrypt(config.password) ?? config.password,
  }, hash);
}
