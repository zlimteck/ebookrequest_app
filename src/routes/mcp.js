import express from 'express';
import axios from 'axios';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

const TOOLS_USER = [
  { name: 'search_books',       description: 'Rechercher un livre via Google Books' },
  { name: 'create_request',     description: 'Soumettre une nouvelle demande' },
  { name: 'get_my_requests',    description: 'Lister mes demandes' },
  { name: 'get_request_details',description: 'Détails d\'une demande par titre' },
  { name: 'cancel_request',     description: 'Annuler une demande en attente' },
  { name: 'check_availability', description: 'Vérifier la disponibilité d\'un livre' },
  { name: 'get_my_stats',       description: 'Mon quota et mes statistiques' },
  { name: 'get_my_library',     description: 'Ma bibliothèque de lecture' },
];

const TOOLS_ADMIN = [
  { name: 'get_pending_requests',  description: 'Toutes les demandes en attente' },
  { name: 'get_all_requests',      description: 'Toutes les demandes (filtre statut)' },
  { name: 'get_admin_stats',       description: 'Statistiques globales' },
  { name: 'update_request_status', description: 'Compléter ou annuler une demande' },
  { name: 'get_user_list',         description: 'Liste des utilisateurs' },
  { name: 'get_services_health',   description: 'État des services (IA, MCP, Apprise, Valentine…)' },
];

router.get('/info', requireAuth, async (req, res) => {
  const mcpUrl = (process.env.MCP_URL || '').replace(/\/$/, '');
  const mcpInternalUrl = (process.env.MCP_INTERNAL_URL || mcpUrl).replace(/\/$/, '');

  if (!mcpUrl) {
    return res.json({ configured: false });
  }

  let online = false;
  try {
    const health = await axios.get(`${mcpInternalUrl}/health`, { timeout: 4000 });
    online = health.data?.status === 'ok';
  } catch {}

  const isAdmin = req.user?.role === 'admin';

  res.json({
    configured: true,
    online,
    url: `${mcpUrl}/mcp`,
    tools: {
      user: TOOLS_USER,
      admin: isAdmin ? TOOLS_ADMIN : [],
    },
  });
});

export default router;