import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import axios from 'axios';
import { z } from 'zod';

const BASE_URL = (process.env.EBOOKREQUEST_URL || '').replace(/\/$/, '');

export function createApi(token) {
  return axios.create({
    baseURL: `${BASE_URL}/api`,
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15000,
  });
}

export function buildServer(api) {
  const server = new McpServer({
    name: 'ebookrequest',
    version: '1.0.0',
    websiteUrl: BASE_URL || undefined,
    icons: BASE_URL ? [{ src: `${BASE_URL}/img/logo.png`, mimeType: 'image/png' }] : undefined,
  });


  server.tool(
    'get_my_requests',
    'Liste mes demandes de livres avec leur statut',
    { status: z.enum(['all', 'pending', 'completed', 'canceled']).optional().default('all') },
    async ({ status }) => {
      const res = await api.get('/requests/my-requests');
      let requests = res.data;
      if (status !== 'all') requests = requests.filter(r => r.status === status);
      if (!requests.length) return { content: [{ type: 'text', text: 'Aucune demande trouvée.' }] };
      const lines = requests.map(r =>
        `• **${r.title}** — ${r.author || 'Auteur inconnu'}\n  Statut: ${r.status} | Format: ${r.format || '—'} | Demandé le: ${new Date(r.createdAt).toLocaleDateString('fr-FR')}`
      );
      return { content: [{ type: 'text', text: lines.join('\n\n') }] };
    }
  );

  server.tool(
    'create_request',
    'Soumettre une nouvelle demande de livre',
    {
      title:  z.string().describe('Titre du livre'),
      author: z.string().describe('Auteur du livre'),
      format: z.enum(['epub', 'mobi', 'pdf']).optional().default('epub'),
      type:   z.enum(['ebook', 'comic', 'manga']).optional().default('ebook'),
    },
    async ({ title, author, format, type }) => {
      let thumbnail = '';
      let description = '';
      let pageCount = 0;
      let link = `https://www.google.com/search?q=${encodeURIComponent(`${title} ${author}`)}+ebook`;

      try {
        const search = await api.get('/books/search', { params: { q: title, author } });
        const first = search.data?.results?.[0];
        if (first) {
          thumbnail   = first.volumeInfo?.imageLinks?.thumbnail || '';
          description = first.volumeInfo?.description || '';
          pageCount   = first.volumeInfo?.pageCount || 0;
          link        = first.volumeInfo?.previewLink || link;
        }
      } catch (err) {
        console.error('[MCP] Google Books search error:', err.response?.status, err.message);
      }

      await api.post('/requests', { title, author, format, category: type, link, thumbnail, description, pageCount });
      return { content: [{ type: 'text', text: `✅ Demande créée pour **${title}** de ${author} (${format}).` }] };
    }
  );

  server.tool(
    'get_my_stats',
    'Affiche mes statistiques : quota utilisé, livres lus, demandes complétées',
    {},
    async () => {
      const [quotaRes, requestsRes] = await Promise.all([
        api.get('/requests/quota'),
        api.get('/requests/my-requests'),
      ]);
      const quota    = quotaRes.data;
      const requests = requestsRes.data;
      const completed = requests.filter(r => r.status === 'completed').length;
      const pending   = requests.filter(r => r.status === 'pending').length;
      const text = [
        `**Quota** : ${quota.used}/${quota.limit} demandes utilisées (fenêtre de ${quota.windowDays} jours)`,
        `**Demandes complétées** : ${completed}`,
        `**Demandes en attente** : ${pending}`,
        `**Total** : ${requests.length}`,
      ].join('\n');
      return { content: [{ type: 'text', text }] };
    }
  );

  server.tool(
    'get_my_library',
    'Affiche ma bibliothèque de lecture',
    { status: z.enum(['all', 'to_read', 'reading', 'read']).optional().default('all') },
    async ({ status }) => {
      const params = status !== 'all' ? { status } : {};
      const res = await api.get('/reading', { params });
      const books = res.data;
      if (!books.length) return { content: [{ type: 'text', text: 'Bibliothèque vide.' }] };
      const lines = books.map(b => {
        const progress = b.readingProgress > 0 ? ` | ${b.readingProgress}%` : '';
        const rating   = b.rating ? ` | ${'⭐'.repeat(b.rating)}` : '';
        return `• **${b.title}** — ${b.author || '—'} (${b.format || '—'})${progress}${rating}\n  id: \`${b._id}\``;
      });
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );

  server.tool(
    'get_pending_requests',
    '[Admin] Liste toutes les demandes en attente de tous les utilisateurs',
    {},
    async () => {
      const res = await api.get('/requests/all');
      const pending = res.data.filter(r => r.status === 'pending');
      if (!pending.length) return { content: [{ type: 'text', text: 'Aucune demande en attente.' }] };
      const lines = pending.map(r =>
        `• **${r.title}** — ${r.author || '—'}\n  Par: ${r.username} | Format: ${r.format || '—'} | ${new Date(r.createdAt).toLocaleDateString('fr-FR')}`
      );
      return { content: [{ type: 'text', text: `${pending.length} demande(s) en attente :\n\n${lines.join('\n\n')}` }] };
    }
  );

  server.tool(
    'get_all_requests',
    '[Admin] Liste toutes les demandes avec filtre optionnel par statut',
    { status: z.enum(['all', 'pending', 'completed', 'canceled']).optional().default('all') },
    async ({ status }) => {
      const res = await api.get('/requests/all');
      let requests = res.data;
      if (status !== 'all') requests = requests.filter(r => r.status === status);
      if (!requests.length) return { content: [{ type: 'text', text: 'Aucune demande trouvée.' }] };
      const lines = requests.map(r =>
        `• **${r.title}** (${r.status}) — ${r.username} | ${new Date(r.createdAt).toLocaleDateString('fr-FR')}`
      );
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );

  server.tool(
    'get_admin_stats',
    '[Admin] Statistiques globales de l\'application',
    {},
    async () => {
      const res = await api.get('/admin/stats');
      const d = res.data?.data || res.data;
      const text = [
        `**Utilisateurs** : ${d.users?.total ?? d.totalUsers ?? '—'}`,
        `**Demandes totales** : ${d.requests?.total ?? d.totalRequests ?? '—'}`,
        `**En attente** : ${d.requests?.pending ?? d.pendingRequests ?? '—'}`,
        `**Complétées** : ${d.requests?.completed ?? d.completedRequests ?? '—'}`,
        `**Annulées** : ${d.requests?.cancelled ?? d.requests?.canceled ?? d.canceledRequests ?? '—'}`,
      ].join('\n');
      return { content: [{ type: 'text', text }] };
    }
  );

  server.tool(
    'search_books',
    'Rechercher un livre via Google Books avant de soumettre une demande',
    {
      query:  z.string().describe('Titre, auteur ou ISBN'),
      author: z.string().optional().describe('Auteur (optionnel, affine la recherche)'),
    },
    async ({ query, author }) => {
      const params = { q: query };
      if (author) params.author = author;
      const res = await api.get('/books/search', { params });
      const results = res.data?.results || [];
      if (!results.length) return { content: [{ type: 'text', text: 'Aucun livre trouvé.' }] };
      const lines = results.slice(0, 5).map((b, i) => {
        const v = b.volumeInfo;
        const authors = (v.authors || []).join(', ') || '—';
        const year = v.publishedDate?.slice(0, 4) || '—';
        return `**${i + 1}. ${v.title}** — ${authors} (${year})\n  ${v.description?.slice(0, 100) || ''}…`;
      });
      return { content: [{ type: 'text', text: lines.join('\n\n') }] };
    }
  );

  server.tool(
    'get_request_details',
    'Voir les détails d\'une demande : description, couverture, commentaire admin',
    { title: z.string().describe('Titre du livre (recherche partielle)') },
    async ({ title }) => {
      const res = await api.get('/requests/my-requests');
      const search = title.toLowerCase();
      const r = res.data.find(x => x.title?.toLowerCase().includes(search));
      if (!r) return { content: [{ type: 'text', text: `Aucune demande trouvée pour "${title}".` }] };
      const lines = [
        `**${r.title}** — ${r.author || '—'}`,
        `Statut : ${r.status} | Format : ${r.format || '—'}`,
        r.description ? `Description : ${r.description.slice(0, 200)}…` : null,
        r.adminComment ? `💬 Commentaire admin : ${r.adminComment}` : null,
        r.downloadLink ? `📥 Lien de téléchargement disponible` : null,
        `Demandé le : ${new Date(r.createdAt).toLocaleDateString('fr-FR')}`,
      ].filter(Boolean);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );

  server.tool(
    'cancel_request',
    'Annuler une de ses demandes en attente',
    { title: z.string().describe('Titre du livre dont annuler la demande (recherche partielle)') },
    async ({ title }) => {
      const res = await api.get('/requests/my-requests');
      const search = title.toLowerCase();
      const r = res.data.find(x => x.status === 'pending' && x.title?.toLowerCase().includes(search));
      if (!r) return { content: [{ type: 'text', text: `Aucune demande en attente trouvée pour "${title}".` }] };
      await api.delete(`/requests/${r._id}`);
      return { content: [{ type: 'text', text: `✅ Demande **${r.title}** annulée.` }] };
    }
  );

  server.tool(
    'check_availability',
    'Vérifier si un livre est disponible au téléchargement (PreDB, Valentine, Anna\'s Archive)',
    {
      title:  z.string().describe('Titre du livre'),
      author: z.string().describe('Auteur du livre'),
    },
    async ({ title, author }) => {
      const res = await api.post('/availability/check', { title, author });
      const d = res.data;
      const icon = d.available ? '✅' : '❌';
      const conf = d.confidence === 'high' ? 'Haute' : d.confidence === 'medium' ? 'Moyenne' : 'Faible';
      const text = `${icon} **${d.available ? 'Disponible' : 'Non disponible'}** (confiance : ${conf})\n${d.message || ''}`;
      return { content: [{ type: 'text', text }] };
    }
  );

  server.tool(
    'direct_search',
    'Recherche directe et immédiate sur Valentine.wtf (titre, auteur ou série), en contournant le workflow normal de demande/attente. Peut être désactivée par un administrateur. En mode auteur/série, renvoie une liste de fiches à choisir (utiliser ensuite direct_search_books avec l\'url choisie).',
    {
      query: z.string().describe('Terme de recherche : titre du livre, nom d\'auteur ou nom de série'),
      mode:  z.enum(['title', 'author', 'series']).optional().default('title').describe('Type de recherche'),
    },
    async ({ query, mode }) => {
      const res = await api.get('/requests/direct-search', { params: { mode, q: query } });
      const d = res.data;
      if (d.unavailable) return { content: [{ type: 'text', text: `⚠️ Recherche directe indisponible : ${d.error || 'source injoignable.'}` }] };

      if (d.mode === 'title') {
        const results = d.results || [];
        if (!results.length) return { content: [{ type: 'text', text: 'Aucun résultat.' }] };
        const lines = results.map(r => `• **${r.title}** — ${r.author || 'Auteur inconnu'}\n  id: \`${r.id}\`${r.valentineUrl ? `\n  link: \`${r.valentineUrl}\`` : ''}`);
        return { content: [{ type: 'text', text: lines.join('\n\n') }] };
      }

      const matches = d.matches || [];
      if (!matches.length) return { content: [{ type: 'text', text: 'Aucune fiche trouvée.' }] };
      const label = mode === 'series' ? 'série' : 'auteur';
      const lines = matches.map(m => `• **${m.name}**${m.hint ? ` (${m.hint})` : ''}\n  url: \`${m.url}\``);
      return { content: [{ type: 'text', text: `Fiches ${label} trouvées (utilisez direct_search_books avec l'url choisie pour lister les livres) :\n\n${lines.join('\n\n')}` }] };
    }
  );

  server.tool(
    'direct_search_books',
    'Liste les livres d\'une fiche auteur ou série Valentine trouvée via direct_search (mode author ou series)',
    {
      type: z.enum(['author', 'series']).describe('Type de fiche'),
      url:  z.string().describe('URL relative de la fiche, renvoyée par direct_search (champ url)'),
      name: z.string().optional().describe('Nom de l\'auteur ou de la série (repli si un livre n\'a pas d\'auteur détecté)'),
    },
    async ({ type, url, name }) => {
      const params = { type, url };
      if (name) params.name = name;
      const res = await api.get('/requests/direct-search-books', { params });
      const d = res.data;
      if (d.unavailable) return { content: [{ type: 'text', text: `⚠️ Recherche directe indisponible : ${d.error || 'source injoignable.'}` }] };
      const results = d.results || [];
      if (!results.length) return { content: [{ type: 'text', text: 'Aucun livre trouvé pour cette fiche.' }] };
      const lines = results.map(r => `• **${r.title}** — ${r.author || 'Auteur inconnu'}\n  id: \`${r.id}\`${r.valentineUrl ? `\n  link: \`${r.valentineUrl}\`` : ''}`);
      return { content: [{ type: 'text', text: lines.join('\n\n') }] };
    }
  );

  server.tool(
    'direct_download',
    'Télécharge immédiatement un livre trouvé via direct_search / direct_search_books et crée la demande correspondante, en contournant le workflow normal d\'attente',
    {
      ebook_id:       z.string().describe('ID Valentine du livre (champ id des résultats de direct_search / direct_search_books)'),
      title:          z.string().describe('Titre du livre'),
      author:         z.string().describe('Auteur du livre'),
      link:           z.string().optional().describe('Lien externe optionnel associé à la demande'),
      published_date: z.string().optional().describe('Date de publication (YYYY, YYYY-MM ou YYYY-MM-DD)'),
      category:       z.enum(['ebook', 'comic', 'manga']).optional().default('ebook'),
      shelves:        z.array(z.string()).optional().describe('Noms exacts des étagères Calibre-Web (voir get_my_shelves) où pousser ce livre. Si absent, les étagères par défaut du profil sont utilisées.'),
    },
    async ({ ebook_id, title, author, link, published_date, category, shelves }) => {
      const res = await api.post('/requests/direct-download', {
        ebookId: ebook_id,
        title,
        author,
        link,
        publishedDate: published_date,
        category,
        selectedShelves: shelves,
      });
      const d = res.data;
      if (d.success === false) {
        return { content: [{ type: 'text', text: `⏳ Demande créée pour **${title}** mais le téléchargement immédiat a échoué : ${d.error || 'erreur inconnue'}. Elle reste en attente pour un nouvel essai.` }] };
      }
      return { content: [{ type: 'text', text: `✅ **${title}** téléchargé et ajouté (${category}).` }] };
    }
  );

  server.tool(
    'get_my_shelves',
    'Lister mes étagères Calibre-Web configurées (noms à utiliser avec direct_download)',
    {},
    async () => {
      const res = await api.get('/users/calibre');
      const d = res.data;
      if (!d.enabled) return { content: [{ type: 'text', text: 'Calibre-Web n\'est pas configuré/activé sur votre compte.' }] };
      const shelves = d.shelves || [];
      if (!shelves.length) return { content: [{ type: 'text', text: 'Aucune étagère configurée.' }] };
      const lines = shelves.map(s => `• ${s.name}${s.isDefault ? ' (par défaut)' : ''}`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );

  server.tool(
    'get_user_list',
    '[Admin] Lister les utilisateurs avec leur quota, rôle et dernière activité',
    {},
    async () => {
      const res = await api.get('/admin/users');
      const users = res.data;
      if (!users.length) return { content: [{ type: 'text', text: 'Aucun utilisateur.' }] };
      const lines = users.map(u => {
        const lastSeen = u.lastActivity
          ? new Date(u.lastActivity).toLocaleDateString('fr-FR')
          : 'jamais';
        const status = u.isActive === false ? ' ⛔' : '';
        return `• **${u.username}**${status} — ${u.role} | Quota : ${u.requestLimit ?? '∞'}/${u.requestLimitDays ?? 30}j | Vu : ${lastSeen}`;
      });
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );

  server.tool(
    'get_services_health',
    '[Admin] Vérifier l\'état des services (IA, MCP, Apprise, Calibre-Web, Valentine, Anna\'s Archive…). Présente le résultat sous forme de liste, pas de tableau.',
    {},
    async () => {
      const res = await api.get('/admin/health');
      const services = res.data?.services || {};
      const lines = Object.entries(services).map(([key, s]) => {
        const name = {
          aiProvider: `IA (${s.provider || 'inconnu'})`,
          flareSolverr: 'FlareSolverr',
          apprise: 'Apprise',
          calibreWeb: 'Calibre-Web',
          valentine: 'Valentine.wtf',
          annasArchive: "Anna's Archive",
          mcp: 'Serveur MCP',
        }[key] || key;

        if (s.enabled === false) return `⚪ **${name}** — Non configuré`;
        const ok = s.connected ?? s.reachable ?? false;
        const icon = ok ? '🟢' : '🔴';
        const details = [];
        if (s.model) details.push(`modèle : ${s.model}`);
        if (s.version) details.push(`v${s.version}`);
        if (s.url) details.push(s.url);
        if (s.quota) details.push(`quota : ${s.quota.remaining ?? '—'}/${s.quota.total ?? '—'}`);
        if (!ok && s.error) details.push(`erreur : ${s.error}`);
        return `${icon} **${name}**${details.length ? ' — ' + details.join(', ') : ''}`;
      });
      const checkedAt = res.data?.checkedAt
        ? new Date(res.data.checkedAt).toLocaleTimeString('fr-FR')
        : '—';
      return { content: [{ type: 'text', text: `Santé des services (${checkedAt}) :\n\n${lines.join('\n')}` }] };
    }
  );

  server.tool(
    'update_request_status',
    '[Admin] Changer le statut d\'une demande (compléter ou annuler)',
    {
      request_id: z.string().describe('ID de la demande'),
      status:     z.enum(['completed', 'canceled']).describe('Nouveau statut'),
      comment:    z.string().optional().describe('Commentaire admin optionnel'),
    },
    async ({ request_id, status, comment }) => {
      await api.patch(`/requests/${request_id}/status`, { status, adminComment: comment });
      return { content: [{ type: 'text', text: `✅ Demande ${request_id} passée en **${status}**.` }] };
    }
  );

  server.tool(
    'search_authors',
    'Rechercher un auteur sur Open Library pour pouvoir le suivre ensuite',
    { query: z.string().describe('Nom de l\'auteur') },
    async ({ query }) => {
      const res = await api.get('/authors/search', { params: { q: query } });
      const authors = res.data?.authors || [];
      if (!authors.length) return { content: [{ type: 'text', text: 'Aucun auteur trouvé.' }] };
      const lines = authors.slice(0, 10).map(a =>
        `• **${a.name}**${a.topWork ? ` — connu pour : ${a.topWork}` : ''}\n  key: \`${a.key}\``
      );
      return { content: [{ type: 'text', text: lines.join('\n\n') }] };
    }
  );

  server.tool(
    'follow_author',
    'Suivre un auteur (trouvé via search_authors) pour être notifié de ses nouvelles sorties',
    {
      key:          z.string().describe('Clé Open Library de l\'auteur (champ key des résultats de search_authors)'),
      auto_request: z.boolean().optional().default(false).describe('Créer automatiquement une demande dès qu\'une nouvelle sortie de cet auteur est détectée'),
    },
    async ({ key, auto_request }) => {
      const res = await api.post(`/authors/${key}/follow`, { autoRequest: auto_request });
      const a = res.data?.author;
      return { content: [{ type: 'text', text: `✅ Vous suivez maintenant **${a?.name || key}**${auto_request ? ' (demande automatique activée)' : ''}.` }] };
    }
  );

  server.tool(
    'unfollow_author',
    'Arrêter de suivre un auteur',
    { key: z.string().describe('Clé Open Library de l\'auteur (voir get_my_followed_authors)') },
    async ({ key }) => {
      await api.delete(`/authors/${key}/follow`);
      return { content: [{ type: 'text', text: `✅ Vous ne suivez plus cet auteur.` }] };
    }
  );

  server.tool(
    'get_my_followed_authors',
    'Lister les auteurs que je suis actuellement',
    {},
    async () => {
      const res = await api.get('/authors/me/followed');
      const authors = res.data?.authors || [];
      if (!authors.length) return { content: [{ type: 'text', text: 'Vous ne suivez aucun auteur.' }] };
      const lines = authors.map(a =>
        `• **${a.name}**${a.autoRequest ? ' 🔁 (demande auto)' : ''}\n  key: \`${a.openLibraryKey}\``
      );
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );

  server.tool(
    'prowlarr_search',
    'Rechercher un livre via les indexeurs torrent configurés dans Prowlarr. Peut être désactivé par un administrateur. Recherche uniquement, pas de téléchargement (réservé aux admins).',
    { query: z.string().min(2).describe('Titre, auteur ou mots-clés (2 caractères minimum)') },
    async ({ query }) => {
      const res = await api.get('/requests/prowlarr-search', { params: { q: query } });
      const d = res.data;
      if (d.unavailable) return { content: [{ type: 'text', text: `⚠️ Recherche Prowlarr indisponible : ${d.error || 'source injoignable ou non configurée.'}` }] };
      const results = d.results || [];
      if (!results.length) return { content: [{ type: 'text', text: 'Aucun résultat Prowlarr.' }] };
      const lines = results.slice(0, 10).map(r => {
        const sizeMb = r.size ? ` | ${(r.size / 1024 / 1024).toFixed(0)} Mo` : '';
        return `• **${r.title}**\n  Indexeur : ${r.indexer || '—'} | Seeders : ${r.seeders ?? '—'}${sizeMb}\n  guid: \`${r.guid}\` | indexerId: \`${r.indexerId}\``;
      });
      return { content: [{ type: 'text', text: lines.join('\n\n') }] };
    }
  );

  server.tool(
    'get_upcoming_releases',
    'Lister les prochaines sorties de livres (source BnF et/ou Hardcover)',
    {
      search: z.string().optional().describe('Filtre par titre ou auteur'),
      source: z.enum(['all', 'bnf', 'hardcover']).optional().default('all'),
      limit:  z.number().int().min(1).max(50).optional().default(20),
    },
    async ({ search, source, limit }) => {
      const params = { limit, sort: 'date', dir: 'asc' };
      if (search) params.search = search;
      if (source !== 'all') params.source = source;
      const res = await api.get('/upcoming-releases', { params });
      const items = res.data?.items || [];
      if (!items.length) return { content: [{ type: 'text', text: 'Aucune sortie à venir trouvée.' }] };
      const lines = items.map(it => {
        const date = it.releaseDate ? new Date(it.releaseDate).toLocaleDateString('fr-FR') : 'date inconnue';
        return `• **${it.title}** — ${it.author || 'Auteur inconnu'}\n  Sortie le ${date} | Source : ${it.source}${it.publisher ? ` | ${it.publisher}` : ''}`;
      });
      return { content: [{ type: 'text', text: lines.join('\n\n') }] };
    }
  );

  server.tool(
    'update_reading_progress',
    'Mettre à jour un livre de ma bibliothèque : statut, note, progression ou notes personnelles (voir get_my_library pour l\'id)',
    {
      book_id:          z.string().describe('ID du livre dans ma bibliothèque (champ id de get_my_library)'),
      status:           z.enum(['to_read', 'reading', 'read']).optional(),
      rating:           z.number().int().min(0).max(5).optional().describe('Note sur 5'),
      reading_progress: z.number().int().min(0).max(100).optional().describe('Progression en %'),
      notes:            z.string().optional(),
    },
    async ({ book_id, status, rating, reading_progress, notes }) => {
      const body = {};
      if (status !== undefined) body.status = status;
      if (rating !== undefined) body.rating = rating;
      if (reading_progress !== undefined) body.readingProgress = reading_progress;
      if (notes !== undefined) body.notes = notes;
      const res = await api.put(`/reading/${book_id}`, body);
      return { content: [{ type: 'text', text: `✅ **${res.data.title}** mis à jour.` }] };
    }
  );

  server.tool(
    'add_to_library',
    'Ajouter manuellement un livre à ma bibliothèque de lecture',
    {
      title:           z.string(),
      author:          z.string(),
      thumbnail:       z.string().optional(),
      google_books_id: z.string().optional(),
    },
    async ({ title, author, thumbnail, google_books_id }) => {
      const res = await api.post('/reading', { title, author, thumbnail, googleBooksId: google_books_id });
      return { content: [{ type: 'text', text: `✅ **${res.data.title}** ajouté à votre bibliothèque.\n  id: \`${res.data._id}\`` }] };
    }
  );

  server.tool(
    'remove_from_library',
    'Retirer un livre de ma bibliothèque (voir get_my_library pour l\'id)',
    { book_id: z.string().describe('ID du livre (champ id de get_my_library)') },
    async ({ book_id }) => {
      await api.delete(`/reading/${book_id}`);
      return { content: [{ type: 'text', text: '✅ Livre retiré de votre bibliothèque.' }] };
    }
  );

  server.tool(
    'get_notifications',
    'Voir mes notifications non lues, ou l\'historique des 7 derniers jours',
    { scope: z.enum(['unseen', 'history']).optional().default('unseen') },
    async ({ scope }) => {
      const res = await api.get(scope === 'history' ? '/notifications/history' : '/notifications/unseen');
      const notifications = res.data?.notifications || [];
      if (!notifications.length) return { content: [{ type: 'text', text: scope === 'history' ? 'Aucune notification sur les 7 derniers jours.' : 'Aucune notification non lue.' }] };
      const typeLabel = { completed: 'Complétée', canceled: 'Annulée', adminComment: 'Commentaire admin' };
      const lines = notifications.map(n => {
        const seen = n.seen ? ' (déjà vue)' : '';
        if (n.standalone) {
          return `• **${n.notification.type}**${seen}\n  ${n.notification.message || ''}\n  id: \`${n.notification._id}\` (standalone)`;
        }
        const r = n.request;
        return `• **${typeLabel[n.type] || n.type}** — ${r.title} (${r.author || '—'})${seen}\n  id: \`${r._id}\``;
      });
      return { content: [{ type: 'text', text: lines.join('\n\n') }] };
    }
  );

  server.tool(
    'mark_notification_seen',
    'Marquer une notification comme lue (voir get_notifications pour l\'id et le type)',
    {
      id:         z.string().describe('ID de la demande ou de la notification standalone'),
      standalone: z.boolean().optional().default(false).describe('true si c\'est une notification standalone (champ "(standalone)" dans get_notifications)'),
      type:       z.enum(['completed', 'canceled', 'adminComment']).optional().default('completed').describe('Type de notification (ignoré si standalone)'),
    },
    async ({ id, standalone, type }) => {
      if (standalone) {
        await api.post(`/notifications/standalone/${id}/seen`);
      } else {
        await api.post(`/notifications/${id}/seen`, { type });
      }
      return { content: [{ type: 'text', text: '✅ Notification marquée comme lue.' }] };
    }
  );

  server.tool(
    'search_my_content',
    'Rechercher dans mes propres demandes et ma bibliothèque de lecture',
    { query: z.string().min(2).describe('Terme de recherche (titre ou auteur, 2 caractères minimum)') },
    async ({ query }) => {
      const res = await api.get('/search', { params: { q: query } });
      const results = res.data?.results || {};
      const sections = [];
      if (results.demandes?.length) {
        sections.push(`**Mes demandes :**\n${results.demandes.map(r => `• ${r.title} — ${r.author || '—'} (${r.status})`).join('\n')}`);
      }
      if (results.bibliotheque?.length) {
        sections.push(`**Ma bibliothèque :**\n${results.bibliotheque.map(b => `• ${b.title} — ${b.author || '—'} (${b.status})`).join('\n')}`);
      }
      if (!sections.length) return { content: [{ type: 'text', text: 'Aucun résultat.' }] };
      return { content: [{ type: 'text', text: sections.join('\n\n') }] };
    }
  );

  server.tool(
    'get_my_profile',
    'Voir les informations de base de mon compte',
    {},
    async () => {
      const res = await api.get('/user/me');
      const u = res.data?.user || {};
      const lines = [
        `**${u.username}** (${u.role})`,
        `Email : ${u.email}${u.emailVerified ? ' ✅' : ' (non vérifié)'}`,
        u.kindleEmail ? `Kindle : ${u.kindleEmail}` : null,
      ].filter(Boolean);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );

  server.tool(
    'get_my_achievements',
    'Voir mes succès/badges débloqués et ma série d\'activité',
    {},
    async () => {
      const res = await api.get('/user/me/achievements');
      const d = res.data;
      const lines = [`🔥 Série actuelle : ${d.streak?.current ?? 0} jours (record : ${d.streak?.longest ?? 0})`, ''];
      for (const cat of d.categories || []) {
        if (cat.tiers) {
          const unlockedCount = cat.tiers.filter(t => t.unlocked).length;
          lines.push(`${unlockedCount > 0 ? '🏆' : '⬜'} **${cat.label}** — ${unlockedCount}/${cat.tiers.length} palier(s) (${cat.count})`);
        } else {
          lines.push(`${cat.unlocked ? '🏆' : '⬜'} **${cat.label}**`);
        }
      }
      lines.push('', `Total débloqué : ${d.summary?.unlocked ?? '—'}/${d.summary?.total ?? '—'}`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );

  server.tool(
    'get_trending_releases',
    'Voir les livres tendance du mois (bestsellers), par catégorie optionnelle',
    { category: z.enum(['all', 'thriller', 'romance', 'sf', 'bd', 'fantasy', 'literary']).optional().default('all') },
    async ({ category }) => {
      const res = await api.get('/trending/monthly', { params: { category } });
      const books = res.data?.data || [];
      if (!books.length) return { content: [{ type: 'text', text: 'Aucun livre tendance trouvé.' }] };
      const lines = books.map(b => `**${b.trending_rank}. ${b.title}** — ${b.author}`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    }
  );

  server.tool(
    'get_recommendations',
    'Voir mes recommandations de lecture générées par IA (basées sur mon historique)',
    { limit: z.number().int().min(1).max(20).optional().default(5) },
    async ({ limit }) => {
      const res = await api.get('/recommendations', { params: { limit } });
      const d = res.data;
      if (d.aiEnabled === false) return { content: [{ type: 'text', text: 'Les recommandations IA ne sont pas activées sur ce serveur.' }] };
      const recs = d.recommendations || [];
      if (!recs.length) return { content: [{ type: 'text', text: 'Aucune recommandation disponible.' }] };
      const lines = recs.map(r => `• **${r.title}** — ${r.author}\n  ${r.reason || ''}`);
      return { content: [{ type: 'text', text: lines.join('\n\n') }] };
    }
  );

  server.tool(
    'regenerate_recommendations',
    'Régénérer mes recommandations IA (limité à 3 fois par 7 jours)',
    {},
    async () => {
      const res = await api.post('/recommendations/regenerate');
      const d = res.data;
      if (d.aiEnabled === false) return { content: [{ type: 'text', text: 'Les recommandations IA ne sont pas activées sur ce serveur.' }] };
      if (d.success === false) return { content: [{ type: 'text', text: `⚠️ ${d.message}` }] };
      const lines = (d.recommendations || []).map(r => `• **${r.title}** — ${r.author}\n  ${r.reason || ''}`);
      return { content: [{ type: 'text', text: `✅ Nouvelles recommandations :\n\n${lines.join('\n\n')}` }] };
    }
  );

  return server;
}
