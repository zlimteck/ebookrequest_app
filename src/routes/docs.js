import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireAuth } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = express.Router();

// Sections ## entièrement réservées aux admins dans API.md.
const ADMIN_SECTIONS = ['Administration', 'Invitations', 'Connecteurs (admin)', 'Réglages (admin)', 'Apprise (admin)'];

// Filtre API.md pour un rôle donné : retire les sections ## admin ainsi que les
// sous-routes explicitement marquées "(admin)" au niveau ### dans les sections gardées
// (ex. POST /api/requests/:id/extra-shelves). Lu à chaque requête (même principe que
// /api/legal/*) pour toujours refléter le fichier réellement déployé, jamais de contenu
// dupliqué à la main — voir lien "Documentation API" dans Paramètres.
function filterApiDocs(markdown, isAdmin) {
  if (isAdmin) return markdown;

  const lines = markdown.split('\n');
  const out = [];
  let skippingSection = false;
  let skippingSubsection = false;

  for (const line of lines) {
    if (line.startsWith('## ')) {
      skippingSection = ADMIN_SECTIONS.includes(line.slice(3).trim());
      skippingSubsection = false;
      if (skippingSection) continue;
    } else if (line.startsWith('### ')) {
      skippingSubsection = /\(admin\)\s*$/i.test(line.trim());
      if (skippingSection || skippingSubsection) continue;
    } else if (skippingSection || skippingSubsection) {
      continue;
    }
    out.push(line);
  }

  return out.join('\n');
}

// GET /api/docs/api — documentation API.md adaptée au rôle de l'utilisateur connecté.
router.get('/api', requireAuth, (req, res) => {
  try {
    const content = fs.readFileSync(path.join(__dirname, '../../API.md'), 'utf8');
    res.json({ content: filterApiDocs(content, req.user.role === 'admin') });
  } catch {
    res.status(404).json({ error: 'Document introuvable.' });
  }
});

export default router;
