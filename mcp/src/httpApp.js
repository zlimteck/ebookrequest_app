import express from 'express';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createApi, buildServer } from './mcpServer.js';

// Même fenêtre/limite que les endpoints OAuth standards du SDK
// (authorize/token) — ces deux routes maison n'en bénéficient pas
// automatiquement.
const customOAuthRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Construit l'app Express HTTP, sans l'écouter sur un port — séparé de
 * index.js pour être testable directement avec supertest.
 *
 * `oauthEnabled` : l'OAuth (feat/mcp-oauth) est entièrement optionnel — une
 * instance qui n'a pas configuré les 5 variables dédiées (MCP_URL,
 * MONGODB_URI, MCP_OAUTH_JWT_SECRET, MCP_LOGIN_TICKET_SECRET,
 * MCP_INTERNAL_SERVICE_SECRET) continue de fonctionner exactement comme
 * avant cette fonctionnalité (token statique EBOOKREQUEST_TOKEN /
 * opdsToken brut en Authorization, sans jamais toucher à Mongo ni monter
 * les routes OAuth) — jamais de refus de démarrer pour ça.
 */
export async function createHttpApp({ mcpUrl, staticFallbackToken, oauthEnabled = true, skipDbConnect = false } = {}) {
  const app = express();

  // Derrière un reverse proxy (NPM/Cloudflare Tunnel) : sans ça, le
  // rate-limiting verrait l'IP du proxy pour tout le monde. `1` = on fait
  // confiance au premier hop devant le conteneur (celui qui pose
  // X-Forwarded-For) — à ajuster si plus d'un reverse proxy est chaîné.
  app.set('trust proxy', 1);
  app.use(express.json());

  if (!oauthEnabled) {
    app.all('/mcp', async (req, res) => {
      try {
        const authHeader = req.headers.authorization || '';
        const match = authHeader.match(/^Bearer\s+(.+)$/i);
        const userToken = (match && match[1]) || staticFallbackToken;
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
    app.get('/health', (_req, res) => res.json({ status: 'ok', oauth: false }));
    return { app, provider: null, resourceUrl: null };
  }

  const { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } = await import('@modelcontextprotocol/sdk/server/auth/router.js');
  const { connectDb } = await import('./db.js');
  const { EbookRequestOAuthProvider } = await import('./oauth/provider.js');
  const { flexibleBearerAuth } = await import('./oauth/flexibleBearerAuth.js');
  const { consumeLoginTicket } = await import('./oauth/loginTicket.js');
  const { renderConsentPage, setAntiClickjackingHeaders } = await import('./oauth/consentPage.js');
  const { timingSafeEqualStrings, generateOpaqueToken, hashToken } = await import('./oauth/tokens.js');
  const { default: PendingAuthorization } = await import('./models/PendingAuthorization.js');
  const { resolveOpdsToken, invalidateOpdsTokenCache } = await import('./oauth/backendClient.js');

  const MCP_URL = mcpUrl ?? process.env.MCP_URL;
  if (!skipDbConnect) await connectDb();

  const RESOURCE_URL = new URL('/mcp', MCP_URL).href;
  const provider = new EbookRequestOAuthProvider(RESOURCE_URL);

  app.use(cookieParser());

  app.use(mcpAuthRouter({
    provider,
    issuerUrl: new URL(MCP_URL),
    resourceServerUrl: new URL(RESOURCE_URL),
    resourceName: 'EbookRequest',
  }));

  const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(new URL(RESOURCE_URL));

  // GET /oauth-continue — retour depuis la page de login EbookRequest
  // (app principale), avec un ticket signé de courte durée prouvant
  // l'identité de l'utilisateur. Affiche l'écran de consentement.
  app.get('/oauth-continue', customOAuthRateLimit, async (req, res) => {
    setAntiClickjackingHeaders(res);
    try {
      const { pending: pendingId, ticket } = req.query;
      if (!pendingId || !ticket) {
        return res.status(400).send('Requête invalide.');
      }

      const pending = await PendingAuthorization.findById(pendingId);
      if (!pending || pending.expiresAt < new Date()) {
        return res.status(400).send('Cette demande d\'autorisation a expiré, veuillez relancer la connexion depuis Claude.');
      }

      // Vérifie que c'est bien le navigateur qui a initié /authorize qui
      // revient ici (cookie posé à ce moment-là) — sans ça, un attaquant
      // pourrait démarrer sa propre demande d'autorisation puis faire
      // suivre ce lien à une victime déjà connectée, dont le compte se
      // retrouverait lié au client de l'attaquant (CSRF de login/mix-up).
      const bindingCookieName = `mcp_binding_${pendingId}`;
      const bindingCookie = req.cookies?.[bindingCookieName];
      res.clearCookie(bindingCookieName, { path: '/oauth-continue' });
      if (!bindingCookie || !timingSafeEqualStrings(hashToken(bindingCookie), pending.bindingHash || '')) {
        await PendingAuthorization.deleteOne({ _id: pendingId });
        return res.status(403).send('Ce lien doit être ouvert dans le navigateur ayant initié la connexion. Veuillez relancer la connexion depuis Claude.');
      }

      const userId = await consumeLoginTicket(ticket);

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

  // POST /oauth-consent — "Autoriser" / "Refuser" sur l'écran précédent.
  app.post('/oauth-consent', customOAuthRateLimit, express.urlencoded({ extended: false }), async (req, res) => {
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

  app.get('/health', (_req, res) => res.json({ status: 'ok', oauth: true }));

  return { app, provider, resourceUrl: RESOURCE_URL };
}
