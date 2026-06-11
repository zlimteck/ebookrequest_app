#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import axios from 'axios';
import { z } from 'zod';

const BASE_URL   = (process.env.EBOOKREQUEST_URL || '').replace(/\/$/, '');
const TOKEN      = process.env.EBOOKREQUEST_TOKEN || '';
const MODE       = process.env.MCP_MODE || 'stdio';           // 'stdio' | 'http'
const PORT       = parseInt(process.env.MCP_PORT || '3035', 10);
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN || '';

if (!BASE_URL || !TOKEN) {
  console.error('EBOOKREQUEST_URL et EBOOKREQUEST_TOKEN sont requis.');
  process.exit(1);
}

const api = axios.create({
  baseURL: `${BASE_URL}/api`,
  headers: { Authorization: `Bearer ${TOKEN}` },
  timeout: 15000,
});

function buildServer() {
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
      // Récupère les métadonnées Google Books (thumbnail, description, pageCount, link)
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
      } catch {}

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
      const s = res.data;
      const text = [
        `**Utilisateurs** : ${s.totalUsers}`,
        `**Demandes totales** : ${s.totalRequests}`,
        `**En attente** : ${s.pendingRequests}`,
        `**Complétées** : ${s.completedRequests}`,
        `**Annulées** : ${s.canceledRequests}`,
      ].join('\n');
      return { content: [{ type: 'text', text }] };
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

  if (AUTH_TOKEN) {
    app.use('/mcp', (req, res, next) => {
      const auth = req.headers.authorization || '';
      if (auth !== `Bearer ${AUTH_TOKEN}`) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      next();
    });
  }

  app.all('/mcp', async (req, res) => {
    try {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const server = buildServer();
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
  const transport = new StdioServerTransport();
  await buildServer().connect(transport);
}