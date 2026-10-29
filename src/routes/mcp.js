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
  { name: 'direct_search',       description: 'Recherche directe et immédiate sur Valentine (titre, auteur ou série)' },
  { name: 'direct_search_books', description: 'Lister les livres d\'une fiche auteur ou série trouvée par direct_search' },
  { name: 'direct_download',     description: 'Télécharger immédiatement un résultat de recherche directe' },
  { name: 'get_my_shelves',      description: 'Lister mes étagères Calibre-Web configurées' },
  { name: 'search_authors',            description: 'Rechercher un auteur sur Open Library' },
  { name: 'follow_author',             description: 'Suivre un auteur' },
  { name: 'unfollow_author',           description: 'Arrêter de suivre un auteur' },
  { name: 'get_my_followed_authors',   description: 'Lister les auteurs que je suis' },
  { name: 'get_upcoming_releases',     description: 'Prochaines sorties (BnF, Hardcover)' },
  { name: 'prowlarr_search',           description: 'Recherche via les indexeurs torrent Prowlarr' },
  { name: 'update_reading_progress',   description: 'Mettre à jour statut/note/progression d\'un livre' },
  { name: 'add_to_library',            description: 'Ajouter manuellement un livre à ma bibliothèque' },
  { name: 'remove_from_library',       description: 'Retirer un livre de ma bibliothèque' },
  { name: 'get_notifications',         description: 'Mes notifications non lues ou historique 7 jours' },
  { name: 'mark_notification_seen',    description: 'Marquer une notification comme lue' },
  { name: 'search_my_content',         description: 'Rechercher dans mes demandes et ma bibliothèque' },
  { name: 'get_my_profile',            description: 'Mes informations de compte' },
  { name: 'get_my_achievements',       description: 'Mes succès/badges et ma série d\'activité' },
  { name: 'get_trending_releases',     description: 'Livres tendance du mois par catégorie' },
  { name: 'get_recommendations',       description: 'Mes recommandations de lecture par IA' },
  { name: 'regenerate_recommendations',description: 'Régénérer mes recommandations IA (3 max/7j)' },
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