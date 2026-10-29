import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';
import express from 'express';

// ── Config de test : base Mongo dédiée (jamais celle de prod), secrets
// factices générés à chaque run, petit serveur HTTP qui simule le backend
// principal (résolution opdsToken + endpoints /api/requests/* utilisés par
// les outils MCP appelés via l'access token). ──
process.env.MCP_URL = 'https://mcp.test.local';
process.env.FRONTEND_URL = 'https://app.test.local';
process.env.MCP_OAUTH_JWT_SECRET = 'test-oauth-jwt-secret';
process.env.MCP_LOGIN_TICKET_SECRET = 'test-login-ticket-secret';
process.env.MCP_INTERNAL_SERVICE_SECRET = 'test-internal-service-secret';
process.env.MONGODB_URI = process.env.MCP_TEST_MONGODB_URI;

if (!process.env.MONGODB_URI) {
  console.error('MCP_TEST_MONGODB_URI est requis pour lancer ces tests.');
  process.exit(1);
}

const TEST_USER_ID = '507f1f77bcf86cd799439011';
const TEST_OPDS_TOKEN = 'test-opds-token-abc123';

let backendServer;
let backendPort;

function startFakeBackend() {
  const app = express();
  app.use(express.json());
  app.get('/api/internal/mcp/users/:id/opds-token', (req, res) => {
    if (req.headers['x-internal-service-secret'] !== process.env.MCP_INTERNAL_SERVICE_SECRET) {
      return res.status(401).json({ error: 'secret invalide' });
    }
    if (req.params.id !== TEST_USER_ID) return res.status(404).json({ error: 'introuvable' });
    res.json({ opdsToken: TEST_OPDS_TOKEN });
  });
  app.get('/api/requests/quota', (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${TEST_OPDS_TOKEN}`);
    res.json({ used: 1, limit: 10, windowDays: 30 });
  });
  app.get('/api/requests/my-requests', (req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${TEST_OPDS_TOKEN}`);
    res.json([]);
  });
  return new Promise((resolve) => {
    backendServer = http.createServer(app).listen(0, '127.0.0.1', () => {
      backendPort = backendServer.address().port;
      process.env.EBOOKREQUEST_URL = `http://127.0.0.1:${backendPort}`;
      resolve();
    });
  });
}

// PKCE S256
function makePkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function makeLoginTicket(userId) {
  return jwt.sign({ sub: userId, jti: crypto.randomUUID() }, process.env.MCP_LOGIN_TICKET_SECRET, { expiresIn: '60s' });
}

let app;
let appWithoutStaticFallback;

before(async () => {
  await startFakeBackend();
  const mod = await import('../src/httpApp.js');
  const built = await mod.createHttpApp({ staticFallbackToken: 'legacy-static-token' });
  app = built.app;

  // Même app, mais sans EBOOKREQUEST_TOKEN configuré côté serveur — pour
  // vérifier le vrai cas "aucun des deux chemins ne fonctionne" (401), sans
  // que le repli legacy masque le test.
  const builtStrict = await mod.createHttpApp({ staticFallbackToken: undefined, skipDbConnect: true });
  appWithoutStaticFallback = builtStrict.app;
});

after(async () => {
  // Nettoyage complet de la base de test dédiée, jamais la base de prod.
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
  await new Promise((resolve) => backendServer.close(resolve));
});

// ── Découverte ──────────────────────────────────────────────────────────────

test('GET /.well-known/oauth-authorization-server renvoie les métadonnées attendues', async () => {
  const res = await request(app).get('/.well-known/oauth-authorization-server');
  assert.equal(res.status, 200);
  assert.equal(res.body.issuer, 'https://mcp.test.local/');
  assert.deepEqual(res.body.response_types_supported, ['code']);
  assert.deepEqual(res.body.code_challenge_methods_supported, ['S256']);
  assert.deepEqual(res.body.grant_types_supported, ['authorization_code', 'refresh_token']);
  assert.ok(res.body.registration_endpoint);
  assert.ok(res.body.revocation_endpoint);
});

test('GET /.well-known/oauth-protected-resource/mcp renvoie la bonne resource', async () => {
  const res = await request(app).get('/.well-known/oauth-protected-resource/mcp');
  assert.equal(res.status, 200);
  assert.equal(res.body.resource, 'https://mcp.test.local/mcp');
  assert.deepEqual(res.body.authorization_servers, ['https://mcp.test.local/']);
});

// ── Compatibilité ascendante : clients déjà configurés avec le token OPDS
// brut en guise de clé API (OpenWebUI, ChatMCP, Claude Desktop) ─────────────

test('mode sans OAuth (variables non configurées) : /mcp fonctionne toujours au token statique, sans jamais toucher Mongo', async () => {
  const mod = await import('../src/httpApp.js');
  // oauthEnabled: false — reproduit exactement une instance self-hosted qui
  // n'a pas ajouté les 5 nouvelles variables d'env en mettant à jour l'image :
  // aucune des deux routes OAuth, aucun appel à connectDb().
  const { app: legacyApp } = await mod.createHttpApp({ staticFallbackToken: TEST_OPDS_TOKEN, oauthEnabled: false });

  const healthRes = await request(legacyApp).get('/health');
  assert.equal(healthRes.status, 200);
  assert.equal(healthRes.body.oauth, false);

  const discoveryRes = await request(legacyApp).get('/.well-known/oauth-authorization-server');
  assert.equal(discoveryRes.status, 404, 'aucune route OAuth ne doit exister dans ce mode');

  const mcpRes = await request(legacyApp)
    .post('/mcp')
    .set('Content-Type', 'application/json')
    .set('Accept', 'application/json, text/event-stream')
    .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_my_stats', arguments: {} } });
  assert.equal(mcpRes.status, 200, 'le repli sur EBOOKREQUEST_TOKEN doit fonctionner sans aucun header Authorization');
});

test('POST /mcp avec un Bearer opdsToken brut (non-JWT) fonctionne sans OAuth, comme avant', async () => {
  const res = await request(app)
    .post('/mcp')
    .set('Authorization', `Bearer ${TEST_OPDS_TOKEN}`)
    .set('Content-Type', 'application/json')
    .set('Accept', 'application/json, text/event-stream')
    .send({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_my_stats', arguments: {} },
    });
  assert.equal(res.status, 200);
  // Le faux backend fait lui-même assert.equal(Authorization, `Bearer ${TEST_OPDS_TOKEN}`)
  // dans ses handlers /api/requests/quota et /api/requests/my-requests : si le
  // token transmis avait été altéré (réécrit, re-signé...), ces assertions
  // auraient fait planter la requête au lieu de renvoyer 200 — la preuve que
  // flexibleBearerAuth laisse ce chemin strictement inchangé, sans jamais
  // passer par la vérification JWT/OAuth.
});

test('GET /mcp sans token renvoie 401 avec WWW-Authenticate pointant vers resource_metadata', async () => {
  const res = await request(appWithoutStaticFallback).post('/mcp').send({});
  assert.equal(res.status, 401);
  assert.match(res.headers['www-authenticate'], /resource_metadata="https:\/\/mcp\.test\.local\/\.well-known\/oauth-protected-resource\/mcp"/);
});

// ── Enregistrement dynamique de client ──────────────────────────────────────

let registeredClient;

test('POST /register avec un redirect_uri HTTPS réussit', async () => {
  const res = await request(app)
    .post('/register')
    .send({
      client_name: 'Claude (test)',
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_method: 'none',
    });
  assert.equal(res.status, 201);
  assert.ok(res.body.client_id);
  assert.equal(res.body.client_secret, undefined); // token_endpoint_auth_method: none
  registeredClient = res.body;
});

test('POST /register rejette un redirect_uri non-HTTPS (hors localhost)', async () => {
  const res = await request(app)
    .post('/register')
    .send({
      client_name: 'Client non sécurisé',
      redirect_uris: ['http://evil.example.com/callback'],
      token_endpoint_auth_method: 'none',
    });
  assert.equal(res.status, 400);
});

test('POST /register accepte http://localhost pour les tests', async () => {
  const res = await request(app)
    .post('/register')
    .send({
      client_name: 'Client local',
      redirect_uris: ['http://localhost:4000/callback'],
      token_endpoint_auth_method: 'none',
    });
  assert.equal(res.status, 201);
});

// ── Flux complet authorize → consentement → token → appel /mcp ─────────────

test('flux complet : authorize, login simulé, consentement, token, appel /mcp', async () => {
  const { verifier, challenge } = makePkce();
  const redirectUri = registeredClient.redirect_uris[0];

  const authRes = await request(app)
    .get('/authorize')
    .query({
      client_id: registeredClient.client_id,
      redirect_uri: redirectUri,
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'xyz',
      resource: 'https://mcp.test.local/mcp',
    });
  assert.equal(authRes.status, 302);
  const loginUrl = new URL(authRes.headers.location);
  assert.equal(loginUrl.origin, 'https://app.test.local');
  assert.equal(loginUrl.pathname, '/login');
  const continueUrl = new URL(loginUrl.searchParams.get('continue'));
  assert.equal(continueUrl.pathname, '/oauth-continue');
  const pendingId = continueUrl.searchParams.get('pending');
  assert.ok(pendingId);

  // Le cookie de liaison navigateur posé par /authorize doit être renvoyé
  // tel quel par le même navigateur à /oauth-continue (voir provider.js).
  const bindingCookieHeader = authRes.headers['set-cookie']
    ?.find((c) => c.startsWith(`mcp_binding_${pendingId}=`));
  assert.ok(bindingCookieHeader, 'le cookie de liaison doit être posé par /authorize');
  const bindingCookie = bindingCookieHeader.split(';')[0];

  // Simule le retour du login EbookRequest avec un ticket signé valide.
  const ticket = makeLoginTicket(TEST_USER_ID);
  const continueRes = await request(app)
    .get('/oauth-continue')
    .set('Cookie', bindingCookie)
    .query({ pending: pendingId, ticket });
  assert.equal(continueRes.status, 200);
  assert.match(continueRes.headers['x-frame-options'], /DENY/);
  const csrfMatch = continueRes.text.match(/name="csrf" value="([^"]+)"/);
  assert.ok(csrfMatch, 'le CSRF doit être présent dans la page de consentement');
  const csrf = csrfMatch[1];

  const consentRes = await request(app)
    .post('/oauth-consent')
    .type('form')
    .send({ pending: pendingId, csrf, decision: 'allow' });
  assert.equal(consentRes.status, 302);
  const redirectAfterConsent = new URL(consentRes.headers.location);
  const code = redirectAfterConsent.searchParams.get('code');
  assert.ok(code);
  assert.equal(redirectAfterConsent.searchParams.get('state'), 'xyz');

  const tokenRes = await request(app)
    .post('/token')
    .type('form')
    .send({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: registeredClient.client_id,
      redirect_uri: redirectUri,
    });
  assert.equal(tokenRes.status, 200);
  assert.ok(tokenRes.body.access_token);
  assert.ok(tokenRes.body.refresh_token);
  assert.equal(tokenRes.body.token_type, 'Bearer');

  // Réutiliser le même code doit échouer.
  const replayRes = await request(app)
    .post('/token')
    .type('form')
    .send({
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: registeredClient.client_id,
      redirect_uri: redirectUri,
    });
  assert.equal(replayRes.status, 400);

  // Appel réel de /mcp avec l'access token OAuth — doit atteindre le faux
  // backend avec l'opdsToken résolu côté serveur (jamais mis dans le JWT).
  const mcpRes = await request(app)
    .post('/mcp')
    .set('Authorization', `Bearer ${tokenRes.body.access_token}`)
    .set('Content-Type', 'application/json')
    .set('Accept', 'application/json, text/event-stream')
    .send({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_my_stats', arguments: {} },
    });
  assert.equal(mcpRes.status, 200);

  // ── Rotation du refresh token ──
  const refreshRes = await request(app)
    .post('/token')
    .type('form')
    .send({ grant_type: 'refresh_token', refresh_token: tokenRes.body.refresh_token, client_id: registeredClient.client_id });
  assert.equal(refreshRes.status, 200);
  assert.ok(refreshRes.body.access_token);
  assert.notEqual(refreshRes.body.refresh_token, tokenRes.body.refresh_token);

  // Réutiliser l'ANCIEN refresh token (déjà tourné) doit échouer et révoquer
  // toute la chaîne — la nouvelle paire issue de la rotation doit aussi
  // cesser de fonctionner après coup.
  const reuseOldRefreshRes = await request(app)
    .post('/token')
    .type('form')
    .send({ grant_type: 'refresh_token', refresh_token: tokenRes.body.refresh_token, client_id: registeredClient.client_id });
  assert.equal(reuseOldRefreshRes.status, 400);

  const refreshAfterTheftRes = await request(app)
    .post('/token')
    .type('form')
    .send({ grant_type: 'refresh_token', refresh_token: refreshRes.body.refresh_token, client_id: registeredClient.client_id });
  assert.equal(refreshAfterTheftRes.status, 400, 'toute la chaîne doit être révoquée après détection de rejeu');
});

test('oauth-continue rejette un pending sans le cookie de liaison (anti CSRF de login/mix-up)', async () => {
  const { challenge } = makePkce();
  const redirectUri = registeredClient.redirect_uris[0];

  // Simule un attaquant qui initie sa propre demande d'autorisation puis
  // transmet le lien /oauth-continue à une victime (sans le cookie posé
  // dans SON navigateur à lui, puisque la victime utilise un navigateur
  // différent).
  const authRes = await request(app)
    .get('/authorize')
    .query({
      client_id: registeredClient.client_id,
      redirect_uri: redirectUri,
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: 'https://mcp.test.local/mcp',
    });
  const continueUrl = new URL(new URL(authRes.headers.location).searchParams.get('continue'));
  const pendingId = continueUrl.searchParams.get('pending');

  const ticket = makeLoginTicket(TEST_USER_ID);
  const res = await request(app)
    .get('/oauth-continue')
    .query({ pending: pendingId, ticket }); // pas de cookie envoyé
  assert.equal(res.status, 403);
});

test('authorize rejette code_challenge_method=plain (PKCE S256 obligatoire)', async () => {
  const redirectUri = registeredClient.redirect_uris[0];
  const res = await request(app)
    .get('/authorize')
    .query({
      client_id: registeredClient.client_id,
      redirect_uri: redirectUri,
      response_type: 'code',
      code_challenge: 'whatever',
      code_challenge_method: 'plain',
    });
  // Erreur post-redirect (phase 2) : redirige vers redirect_uri avec ?error=
  assert.equal(res.status, 302);
  const url = new URL(res.headers.location);
  assert.ok(url.searchParams.get('error'));
});

test('authorize rejette un redirect_uri non enregistré pour ce client', async () => {
  const res = await request(app)
    .get('/authorize')
    .query({
      client_id: registeredClient.client_id,
      redirect_uri: 'https://attacker.example.com/callback',
      response_type: 'code',
      code_challenge: 'whatever',
      code_challenge_method: 'S256',
    });
  assert.equal(res.status, 400); // erreur pré-redirect (phase 1), réponse directe
});
