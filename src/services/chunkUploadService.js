import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sanitizeUploadFilename, ALLOWED_UPLOAD_EXTS, UPLOAD_DIR } from '../middleware/upload.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Upload en chunks : contourne la limite de taille de payload imposée par les proxys
// devant l'instance (ex. Cloudflare, 100 Mo sur le plan gratuit, non configurable) en
// envoyant le fichier en plusieurs petites requêtes au lieu d'une seule. Chaque chunk
// est écrit dans un dossier temporaire par upload, puis réassemblé dans l'ordre une
// fois tous les chunks reçus — le fichier final atterrit directement dans
// uploads/books, exactement comme un upload multer classique.
const TMP_DIR = path.join(__dirname, '../../uploads/tmp-chunks');

function uploadDir(uploadId) {
  // uploadId généré côté serveur (voir initUpload) : jamais de valeur client dans le
  // chemin, pas de risque de traversée de répertoire.
  return path.join(TMP_DIR, uploadId);
}

export function initUpload(originalName) {
  const ext = path.extname(originalName).toLowerCase();
  if (!ALLOWED_UPLOAD_EXTS.includes(ext)) {
    throw new Error(`Type de fichier non autorisé. Formats acceptés : ${ALLOWED_UPLOAD_EXTS.join(', ')}`);
  }
  const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  fs.mkdirSync(uploadDir(uploadId), { recursive: true });
  return uploadId;
}

export function saveChunk(uploadId, index, buffer) {
  const dir = uploadDir(uploadId);
  if (!fs.existsSync(dir)) throw new Error('Upload inconnu ou expiré.');
  fs.writeFileSync(path.join(dir, String(index)), buffer);
}

// Concatène les chunks dans l'ordre et écrit le fichier final dans uploads/books,
// avec le même format de nom que multer (voir sanitizeUploadFilename) — pour que le
// résultat soit indiscernable d'un upload classique côté reste de l'app.
export function finalizeUpload(uploadId, totalChunks, originalName) {
  const dir = uploadDir(uploadId);
  if (!fs.existsSync(dir)) throw new Error('Upload inconnu ou expiré.');

  const filename = sanitizeUploadFilename(originalName);
  const destPath = path.join(UPLOAD_DIR, filename);
  const writeStream = fs.createWriteStream(destPath);

  try {
    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = path.join(dir, String(i));
      if (!fs.existsSync(chunkPath)) throw new Error(`Chunk ${i} manquant.`);
      writeStream.write(fs.readFileSync(chunkPath));
    }
  } finally {
    writeStream.end();
  }

  fs.rmSync(dir, { recursive: true, force: true });
  return { filename, filePath: `books/${filename}` };
}

export function abortUpload(uploadId) {
  fs.rmSync(uploadDir(uploadId), { recursive: true, force: true });
}

// Nettoyage des uploads abandonnés (chunks orphelins jamais finalisés) — appelé une
// fois au démarrage, pas besoin d'un cron dédié pour un cas aussi rare.
export function cleanupStaleUploads(maxAgeMs = 24 * 60 * 60 * 1000) {
  if (!fs.existsSync(TMP_DIR)) return;
  const now = Date.now();
  for (const entry of fs.readdirSync(TMP_DIR)) {
    const entryPath = path.join(TMP_DIR, entry);
    try {
      const stat = fs.statSync(entryPath);
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.rmSync(entryPath, { recursive: true, force: true });
      }
    } catch {
      // ignoré — best-effort
    }
  }
}
