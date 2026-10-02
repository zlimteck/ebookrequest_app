import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Créer le dossier uploads s'il n'existe pas
const uploadDir = path.join(__dirname, '../../uploads/books');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Formats acceptés, partagés avec l'upload chunké (src/services/chunkUploadService.js)
// pour appliquer exactement la même whitelist.
export const ALLOWED_UPLOAD_EXTS = [
  // Ebooks
  '.pdf', '.epub', '.mobi', '.azw', '.azw3', '.kfx',
  // Archives pour BD/Comics
  '.cbz', '.cbr', '.cb7', '.cbt', '.cba', '.djvu',
  // Documents
  '.doc', '.docx', '.txt', '.rtf', '.odt',
  // Images pour BD/Comics
  '.jpg', '.jpeg', '.png', '.webp', '.gif'
];

// Même logique de nom de fichier que multer ci-dessous, exportée pour que l'upload
// chunké (fichier assemblé hors multer) produise des noms identiques/sans collision.
export function sanitizeUploadFilename(originalName) {
  const name = path.parse(originalName).name;
  const ext = path.extname(originalName).toLowerCase();
  const safeName = name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  return `${safeName}-${Date.now()}${ext}`;
}

export const UPLOAD_DIR = uploadDir;

// Configuration de multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, sanitizeUploadFilename(file.originalname));
  }
});

// Filtre pour n'accepter que les fichiers autorisés
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();

  if (ALLOWED_UPLOAD_EXTS.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Type de fichier non autorisé. Formats acceptés : ${ALLOWED_UPLOAD_EXTS.join(', ')}`), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 500 * 1024 * 1024,// 500MB
    fieldSize: 500 * 1024 * 1024  // Important pour les champs de formulaire
  }
});

export default upload;