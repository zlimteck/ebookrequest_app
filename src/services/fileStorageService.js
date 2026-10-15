/**
 * Abstraction du stockage des ebooks (issue #45) — un seul mode actif à la
 * fois (local | webdav, s3 à venir), jamais plusieurs en parallèle (contraire
 * aux destinations de sauvegarde où plusieurs cibles simultanées ont du
 * sens). Toute route qui lit/écrit/liste un ebook doit passer par ici plutôt
 * que par un accès `fs.*` direct — c'est le seul endroit qui connaît le mode
 * configuré.
 *
 * Convention de chemin IMPORTANTE : `relativePath` dans toutes les fonctions
 * ci-dessous est exactement la valeur stockée dans `BookRequest.filePath`
 * (ex. "books/mon-livre-172839.epub"), relative à `uploads/` — PAS au
 * sous-dossier `uploads/books/`. C'est la convention déjà utilisée partout
 * ailleurs dans le code (middleware/upload.js, routes/admin.js...), reprise
 * ici à l'identique pour éviter tout décalage entre les deux.
 *
 * Mode 'local' implémenté en premier : reprend exactement le comportement
 * actuel (aucun changement fonctionnel), pour servir de base de référence
 * avant d'ajouter le mode 'webdav'. Même principe que fileAccessService.js,
 * déjà existant pour la récupération des fichiers Prowlarr.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient as createWebdavClient } from 'webdav';
import ConnectorSettings from '../models/ConnectorSettings.js';
import { decrypt } from './cryptoService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Racine locale de tous les uploads (books/, mais aussi d'autres sous-dossiers
// potentiels à l'avenir) — resolveLocalPath confine tout accès sous ce dossier.
const UPLOADS_ROOT = path.join(__dirname, '../../uploads');

// Sous-dossier spécifique aux ebooks, utilisé pour le listing/les stats
// (uniquement ces fichiers, jamais les sauvegardes/avatars/chunks temporaires
// qui vivent ailleurs sous uploads/).
const BOOKS_SUBDIR = 'books';
export const BOOKS_DIR = path.join(UPLOADS_ROOT, BOOKS_SUBDIR);
if (!fs.existsSync(BOOKS_DIR)) {
  fs.mkdirSync(BOOKS_DIR, { recursive: true });
}

let configCache = null;
export function invalidateBookStorageConfigCache() {
  configCache = null;
}

async function getConfig() {
  if (configCache) return configCache;
  const doc = await ConnectorSettings.findOne({ service: 'bookStorage' }).lean();
  configCache = doc || { service: 'bookStorage', fileStorageMode: 'local' };
  return configCache;
}

function getWebdavClient(config) {
  if (!config.bookStorageWebdavUrl) throw new Error('URL WebDAV non configurée.');
  const password = config.bookStorageWebdavPassword ? decrypt(config.bookStorageWebdavPassword) : undefined;
  return createWebdavClient(config.bookStorageWebdavUrl, {
    username: config.bookStorageWebdavUsername || undefined,
    password: password || undefined,
  });
}

// `relativePath` (ex. "books/foo.epub") est reproduit tel quel sous la racine
// WebDAV configurée — même arborescence relative que côté local.
function webdavRemotePath(relativePath) {
  return `/${relativePath.replace(/^\/+/, '')}`;
}

// Chemin absolu local, confiné à UPLOADS_ROOT — refuse toute tentative de
// traversée de chemin (`../`), quel que soit l'appelant.
function resolveLocalPath(relativePath) {
  const full = path.resolve(UPLOADS_ROOT, relativePath);
  if (full !== UPLOADS_ROOT && !full.startsWith(UPLOADS_ROOT + path.sep)) {
    throw new Error('Chemin de fichier invalide.');
  }
  return full;
}

/** Lit un ebook en entier. */
export async function readBookFile(relativePath) {
  const config = await getConfig();
  if (config.fileStorageMode === 'webdav') {
    const client = getWebdavClient(config);
    const buffer = await client.getFileContents(webdavRemotePath(relativePath), { format: 'binary' });
    return Buffer.from(buffer);
  }
  return fs.readFileSync(resolveLocalPath(relativePath));
}

/** Écrit un ebook (crée ou remplace). */
export async function writeBookFile(relativePath, buffer) {
  const config = await getConfig();
  if (config.fileStorageMode === 'webdav') {
    const client = getWebdavClient(config);
    await client.putFileContents(webdavRemotePath(relativePath), buffer, { overwrite: true });
    return;
  }
  const fullPath = resolveLocalPath(relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, buffer);
}

/** Vérifie l'existence d'un ebook. */
export async function bookFileExists(relativePath) {
  if (!relativePath) return false;
  const config = await getConfig();
  if (config.fileStorageMode === 'webdav') {
    const client = getWebdavClient(config);
    return client.exists(webdavRemotePath(relativePath));
  }
  return fs.existsSync(resolveLocalPath(relativePath));
}

/** Supprime un ebook. Ne lève pas d'erreur si le fichier n'existe déjà plus. */
export async function deleteBookFile(relativePath) {
  const config = await getConfig();
  if (config.fileStorageMode === 'webdav') {
    const client = getWebdavClient(config);
    try {
      await client.deleteFile(webdavRemotePath(relativePath));
    } catch (err) {
      if (err?.status !== 404) throw err;
    }
    return;
  }
  const fullPath = resolveLocalPath(relativePath);
  if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
}

/** Taille d'un seul ebook, sans le lire en entier. */
export async function getBookFileSize(relativePath) {
  const config = await getConfig();
  if (config.fileStorageMode === 'webdav') {
    const client = getWebdavClient(config);
    const stat = await client.stat(webdavRemotePath(relativePath));
    return stat.size;
  }
  return fs.statSync(resolveLocalPath(relativePath)).size;
}

/** Renomme/déplace un ebook. */
export async function renameBookFile(oldRelativePath, newRelativePath) {
  const config = await getConfig();
  if (config.fileStorageMode === 'webdav') {
    const client = getWebdavClient(config);
    await client.moveFile(webdavRemotePath(oldRelativePath), webdavRemotePath(newRelativePath));
    return;
  }
  fs.renameSync(resolveLocalPath(oldRelativePath), resolveLocalPath(newRelativePath));
}

/**
 * Liste tous les ebooks du dossier `books/` — jamais les autres sous-dossiers
 * d'uploads (sauvegardes, avatars, chunks temporaires). Retourne des noms
 * de fichier NUS (sans préfixe "books/"), comme le fait déjà le gestionnaire
 * de fichiers admin (qui reconstruit lui-même le `filePath` complet).
 */
export async function listBookFiles() {
  const config = await getConfig();
  if (config.fileStorageMode === 'webdav') {
    const client = getWebdavClient(config);
    const items = await client.getDirectoryContents(webdavRemotePath(BOOKS_SUBDIR));
    return items
      .filter(i => i.type === 'file')
      .map(i => ({ name: i.basename, size: i.size, mtime: new Date(i.lastmod) }));
  }
  return fs.readdirSync(BOOKS_DIR)
    .filter(name => fs.statSync(path.join(BOOKS_DIR, name)).isFile())
    .map(name => {
      const stat = fs.statSync(path.join(BOOKS_DIR, name));
      return { name, size: stat.size, mtime: stat.mtime };
    });
}

/** Taille totale occupée + nombre de fichiers, pour l'affichage admin. */
export async function getStorageStats() {
  const files = await listBookFiles();
  return {
    fileCount: files.length,
    totalBytes: files.reduce((sum, f) => sum + (f.size || 0), 0),
  };
}

/**
 * Pour les opérations qui exigent un VRAI fichier sur disque (ebook-convert
 * n'accepte qu'un chemin local, jamais un flux/buffer) : copie le fichier
 * dans un dossier temporaire local si on est en mode distant, ne fait rien
 * en mode local (retourne directement le chemin réel). L'appelant doit
 * supprimer le fichier temporaire après usage si `isTemp` est vrai.
 */
export async function ensureLocalCopy(relativePath) {
  const config = await getConfig();
  if (config.fileStorageMode !== 'webdav') {
    return { path: resolveLocalPath(relativePath), isTemp: false };
  }
  const tmpDir = path.join(UPLOADS_ROOT, 'tmp-remote-fetch');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpPath = path.join(tmpDir, `${Date.now()}-${path.basename(relativePath)}`);
  const buffer = await readBookFile(relativePath);
  fs.writeFileSync(tmpPath, buffer);
  return { path: tmpPath, isTemp: true };
}

/** Copie tous les fichiers actuellement en local (dossier books/) vers la destination distante configurée — outil de migration manuelle, pas automatique au changement de mode. */
export async function copyAllLocalToRemote() {
  const config = await getConfig();
  if (config.fileStorageMode !== 'webdav') {
    throw new Error('Aucune destination distante active.');
  }
  const client = getWebdavClient(config);
  const localFiles = fs.readdirSync(BOOKS_DIR).filter(name => fs.statSync(path.join(BOOKS_DIR, name)).isFile());
  let copied = 0, failed = 0;
  for (const name of localFiles) {
    try {
      const buffer = fs.readFileSync(path.join(BOOKS_DIR, name));
      await client.putFileContents(webdavRemotePath(`${BOOKS_SUBDIR}/${name}`), buffer, { overwrite: true });
      copied++;
    } catch (err) {
      console.error(`[FileStorage] Échec copie "${name}" vers le distant:`, err.message);
      failed++;
    }
  }
  return { copied, failed, total: localFiles.length };
}
