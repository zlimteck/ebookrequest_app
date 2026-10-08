import fs from 'fs';
import path from 'path';
import { createClient as createWebdavClient } from 'webdav';
import ConnectorSettings from '../models/ConnectorSettings.js';
import { decrypt } from './cryptoService.js';

// Récupère un fichier terminé dans le client torrent, selon le mode configuré
// (issue #42) — 'local' : volume Docker partagé avec le client, lecture
// directe ; 'webdav' : serveur distant exposant son dossier de téléchargement
// en WebDAV, récupéré en HTTP. `relativePath` = chemin du fichier RELATIF au
// dossier de sauvegarde du torrent (savePath), tel que renvoyé par le client.

export async function fetchCompletedFile(relativePath) {
  const config = await ConnectorSettings.findOne({ service: 'downloadClient' }).lean();
  if (!config) throw new Error('Accès fichier non configuré');

  if (config.fileAccessMode === 'webdav') {
    if (!config.fileAccessWebdavUrl) throw new Error('URL WebDAV non configurée');
    const webdavPassword = decrypt(config.apiKey) ?? config.apiKey;
    const client = createWebdavClient(config.fileAccessWebdavUrl, {
      username: config.fileAccessWebdavUsername || undefined,
      password: webdavPassword || undefined,
    });
    // `relativePath` (chemin du fichier relatif au dossier de sauvegarde du
    // torrent, cohérent entre les 4 adaptateurs) est reconstruit sous la
    // racine WebDAV configurée, précédé du chemin de base si la racine WebDAV
    // ne correspond pas directement au dossier de téléchargement (ex: seedbox
    // où /webdav expose tout le home, torrents dans un sous-dossier) — on
    // ignore `savePath`, propre au système de fichiers DU CLIENT, sans rapport
    // avec l'arborescence WebDAV.
    const basePath = (config.fileAccessWebdavBasePath || '').replace(/^\/+|\/+$/g, '');
    const remotePath = `/${[basePath, relativePath.replace(/^\/+/, '')].filter(Boolean).join('/')}`;
    const buffer = await client.getFileContents(remotePath, { format: 'binary' });
    return Buffer.from(buffer);
  }

  // Mode local : le volume partagé est monté sur CE conteneur à
  // `fileAccessLocalPath`, qui correspond au dossier de téléchargement racine
  // du client (peu importe le chemin qu'IL voit lui-même, ex. `savePath`).
  if (!config.fileAccessLocalPath) throw new Error('Chemin local non configuré');
  const fullPath = path.join(config.fileAccessLocalPath, relativePath);
  if (!fs.existsSync(fullPath)) throw new Error(`Fichier introuvable : ${fullPath}`);
  return fs.readFileSync(fullPath);
}
