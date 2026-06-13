#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import axios from 'axios';
import { z } from 'zod';

const BASE_URL = (process.env.EBOOKREQUEST_URL || '').replace(/\/$/, '');
const TOKEN    = process.env.EBOOKREQUEST_TOKEN || '';
const MODE     = process.env.MCP_MODE || 'stdio';
const PORT     = parseInt(process.env.MCP_PORT || '3035', 10);

if (!BASE_URL) {
  console.error('EBOOKREQUEST_URL est requis.');
  process.exit(1);
}

if (MODE !== 'http' && !TOKEN) {
  console.error('EBOOKREQUEST_TOKEN est requis en mode stdio.');
  process.exit(1);
}

function createApi(token) {
  return axios.create({
    baseURL: `${BASE_URL}/api`,
    headers: { Authorization: `Bearer ${token}` },
    timeout: 15000,
  });
}

function buildServer(api) {
  const server = new McpServer({ name: 'ebookrequest', version: '1.0.0' });

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
        return `• **${b.title}** — ${b.author || '—'} (${b.format || '—'})${progress}${rating}`;
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

  return server;
}

// ── Démarrage ─────────────────────────────────────────────────────────────────

if (MODE === 'http') {
  const { default: express } = await import('express');
  const app = express();
  app.use(express.json());

  app.all('/mcp', async (req, res) => {
    try {
      const authHeader = req.headers.authorization || '';
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      const userToken = (match && match[1]) || TOKEN;

      if (!userToken) {
        return res.status(401).json({ error: 'Token requis. Ajoutez votre token OPDS comme clé API.' });
      }

      const api = createApi(userToken);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const server = buildServer(api);
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  });

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`EbookRequest MCP server (HTTP) running on :${PORT}`);
  });
} else {
  const api = createApi(TOKEN);
  const transport = new StdioServerTransport();
  await buildServer(api).connect(transport);
}
