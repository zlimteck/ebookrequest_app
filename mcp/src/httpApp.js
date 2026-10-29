import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { connectDb } from './db.js';
import { EbookRequestOAuthProvider } from './oauth/provider.js';
import { flexibleBearerAuth } from './oauth/flexibleBearerAuth.js';
import { consumeLoginTicket } from './oauth/loginTicket.js';
import { renderConsentPage, setAntiClickjackingHeaders } from './oauth/consentPage.js';
import { timingSafeEqualStrings, generateOpaqueToken } from './oauth/tokens.js';
import PendingAuthorization from './models/PendingAuthorization.js';
import { resolveOpdsToken, invalidateOpdsTokenCache } from './oauth/backendClient.js';
import { createApi, buildServer } from './mcpServer.js';

/**
 * Construit l'app Express HTTP (OAuth + endpoint /mcp), sans l'écouter sur
 * un port — séparé de index.js pour être testable directement avec
 * supertest, et pour que connectDb() reste sous le contrôle de l'appelant
 * (les tests gèrent leur propre connexion Mongo de test).
 */
export async function createHttpApp({ mcpUrl, staticFallbackToken, skipDbConnect = false } = {}) {
  const MCP_URL = mcpUrl ?? process.env.MCP_URL;
  if (!skipDbConnect) await connectDb();

  const RESOURCE_URL = new URL('/mcp', MCP_URL).href;
  const provider = new EbookRequestOAuthProvider(RESOURCE_URL);

  const app = express();

  // Derrière un reverse proxy (NPM/Cloudflare Tunnel) : sans ça, le
  // rate-limiting intégré au SDK (register/authorize/token) verrait l'IP du
  // proxy pour tout le monde, un seul utilisateur pourrait épuiser le quota
  // de tous les autres. `1` = on fait confiance au premier hop devant le
  // conteneur (celui qui pose X-Forwarded-For) — à ajuster si jamais plus
  // d'un reverse proxy est chaîné devant cette instance.
  app.set('trust proxy', 1);

  app.use(express.json());

  app.use(mcpAuthRouter({
    provider,
    issuerUrl: new URL(MCP_URL),
    resourceServerUrl: new URL(RESOURCE_URL),
    resourceName: 'EbookRequest',
  }));

  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(new URL(RESOURCE_URL));

  // GET /authorize/continue — retour depuis la page de login EbookRequest
  // (app principale), avec un ticket signé de courte durée prouvant
  // l'identité de l'utilisateur. Affiche l'écran de consentement.
  app.get('/authorize/continue', async (req, res) => {
    setAntiClickjackingHeaders(res);
    try {
      const { pending: pendingId, ticket } = req.query;
      if (!pendingId || !ticket) {
        return res.status(400).send('Requête invalide.');
      }

      const userId = await consumeLoginTicket(ticket);

      const pending = await PendingAuthorization.findById(pendingId);
      if (!pending || pending.expiresAt < new Date()) {
        return res.status(400).send('Cette demande d\'autorisation a expiré, veuillez relancer la connexion depuis Claude.');
      }

      const client = await provider.clientsStore.getClient(pending.clientId);
      if (!client) {
        return res.status(400).send('Client OAuth inconnu.');
      }

      const csrfToken = generateOpaqueToken();
      pending.userId = userId;
      pending.csrfToken = csrfToken;
      await pending.save();

      res.type('html').send(renderConsentPage({
        pendingId: pending._id,
        csrfToken,
        clientName: client.client_name,
        redirectUri: pending.redirectUri,
      }));
    } catch (err) {
      res.status(400).send(`Impossible de continuer l'autorisation : ${err.message}`);
    }
  });

  // POST /authorize/consent — "Autoriser" / "Refuser" sur l'écran précédent.
  app.post('/authorize/consent', express.urlencoded({ extended: false }), async (req, res) => {
    setAntiClickjackingHeaders(res);
    try {
      const { pending: pendingId, csrf, decision } = req.body;
      if (!pendingId || !csrf || !decision) {
        return res.status(400).send('Requête invalide.');
      }

      const pending = await PendingAuthorization.findById(pendingId);
      if (!pending || !pending.userId || !pending.csrfToken) {
        return res.status(400).send('Cette demande d\'autorisation a expiré, veuillez relancer la connexion depuis Claude.');
      }
      if (!timingSafeEqualStrings(csrf, pending.csrfToken)) {
        return res.status(403).send('Jeton de sécurité invalide, veuillez relancer la connexion depuis Claude.');
      }

      const redirectUrl = decision === 'allow'
        ? await provider.createAuthorizationCode(pendingId)
        : await provider.denyAuthorization(pendingId);

      res.redirect(302, redirectUrl);
    } catch (err) {
      res.status(400).send(`Impossible de finaliser l'autorisation : ${err.message}`);
    }
  });

  app.all('/mcp', flexibleBearerAuth({ provider, resourceMetadataUrl, staticFallbackToken }), async (req, res) => {
    try {
      let userToken;
      if (req.auth.legacyStaticToken) {
        userToken = req.auth.token;
      } else {
        try {
          userToken = await resolveOpdsToken(req.auth.extra.userId);
        } catch {
          // L'opdsToken n'a peut-être pas pu être résolu parce que le cache
          // tenait une valeur périmée (utilisateur désactivé entre-temps,
          // etc.) — une seule nouvelle tentative après invalidation, pas de
          // boucle de retry.
          invalidateOpdsTokenCache(req.auth.extra.userId);
          userToken = await resolveOpdsToken(req.auth.extra.userId);
        }
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

  return { app, provider, resourceUrl: RESOURCE_URL };
}
