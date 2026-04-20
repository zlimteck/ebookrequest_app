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

// Configuration de multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Conserver le nom de fichier original
    const originalName = path.parse(file.originalname).name;
    const ext = path.extname(file.originalname).toLowerCase();
    // Remplacer les caractères spéciaux et espaces par des underscores
    const safeName = originalName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    // Ajouter un timestamp pour éviter les conflits de noms
    const uniqueSuffix = '-' + Date.now();
    cb(null, safeName + uniqueSuffix + ext);
  }
});

// Filtre pour n'accepter que les fichiers autorisés
const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    // Ebooks
    '.pdf', '.epub', '.mobi', '.azw', '.azw3', '.kfx',
    // Archives pour BD/Comics
    '.cbz', '.cbr', '.cb7', '.cbt', '.cba', '.djvu',
    // Documents
    '.doc', '.docx', '.txt', '.rtf', '.odt',
    // Images pour BD/Comics
    '.jpg', '.jpeg', '.png', '.webp', '.gif'
  ];
  
  const ext = path.extname(file.originalname).toLowerCase();
  
  if (allowedTypes.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`Type de fichier non autorisé. Formats acceptés : ${allowedTypes.join(', ')}`), false);
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