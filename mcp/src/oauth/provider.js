import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { InvalidGrantError, InvalidTargetError, ServerError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { clientsStore } from './clientsStore.js';
import { generateOpaqueToken, hashToken } from './tokens.js';
import AuthorizationCode from '../models/AuthorizationCode.js';
import RefreshToken from '../models/RefreshToken.js';
import PendingAuthorization from '../models/PendingAuthorization.js';
import { resolveOpdsToken } from './backendClient.js';

const JWT_SECRET = process.env.MCP_OAUTH_JWT_SECRET;
const FRONTEND_URL = (process.env.FRONTEND_URL || '').replace(/\/$/, '');

const ACCESS_TOKEN_TTL_S = 60 * 60; // 1h
const AUTH_CODE_TTL_MS = 60 * 1000; // 60s
const PENDING_AUTH_TTL_MS = 10 * 60 * 1000; // 10 min pour aller jusqu'au bout du login
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

export class EbookRequestOAuthProvider {
  // resourceUrl : URL complète de la ressource protégée (ex.
  // https://mcp.ebookrequest.fr/mcp) — dérivée de MCP_URL par index.js,
  // jamais une variable d'env séparée pour éviter toute incohérence entre
  // les deux.
  constructor(resourceUrl) {
    this.resourceUrl = resourceUrl;
  }

  get clientsStore() {
    return clientsStore;
  }

  // Compare l'URL de ressource demandée à la nôtre (RFC 8707), en ignorant
  // un éventuel fragment et un slash final — même tolérance que celle du
  // SDK pour `expectedResource` dans requireBearerAuth.
  #resourceMatches(requested) {
    if (!requested) return true; // resource absent : accepté (RFC 8707 l'autorise)
    const normalize = (u) => u.replace(/#.*$/, '').replace(/\/$/, '');
    return normalize(requested.href ?? String(requested)) === normalize(this.resourceUrl);
  }

  // Ne fait jamais le login/consentement elle-même : redirige vers la page
  // de login existante d'EbookRequest (réutilise bcrypt/2FA/verrouillage
  // sans dupliquer ce code), avec un paramètre `continue` ramenant vers
  // /oauth-continue une fois l'identité prouvée par ticket signé.
  async authorize(client, params, res) {
    if (!this.#resourceMatches(params.resource)) {
      throw new InvalidTargetError('resource ne correspond pas à ce serveur MCP.');
    }
    if (!JWT_SECRET || !FRONTEND_URL || !this.resourceUrl) {
      throw new ServerError('Flux OAuth MCP non configuré sur ce serveur.');
    }

    // Secret de liaison navigateur : posé en cookie HttpOnly sur CE
    // navigateur avant la redirection vers le login, revérifié à
    // /oauth-continue — seul le navigateur qui a réellement initié cette
    // demande d'autorisation peut la faire aboutir, même si le lien
    // /login?continue=... venait à être transmis à quelqu'un d'autre.
    const browserBinding = generateOpaqueToken();

    const pending = await PendingAuthorization.create({
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      resource: params.resource?.href || '',
      state: params.state || '',
      scopes: params.scopes || [],
      bindingHash: hashToken(browserBinding),
      expiresAt: new Date(Date.now() + PENDING_AUTH_TTL_MS),
    });

    res.cookie(`mcp_binding_${pending._id}`, browserBinding, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax', // doit survivre la navigation top-level cross-site au retour du login
      maxAge: PENDING_AUTH_TTL_MS,
      path: '/oauth-continue',
    });

    const continueUrl = new URL('/oauth-continue', this.resourceUrl.replace(/\/mcp$/, ''));
    continueUrl.searchParams.set('pending', pending._id);

    const loginUrl = new URL('/login', FRONTEND_URL);
    loginUrl.searchParams.set('continue', continueUrl.href);

    res.redirect(302, loginUrl.href);
  }

  // Le SDK appelle cette méthode avant la nôtre pour la validation PKCE —
  // on se contente de retrouver le challenge stocké, jamais de comparaison
  // ici (verifyChallenge le fait côté SDK).
  async challengeForAuthorizationCode(client, authorizationCode) {
    const record = await AuthorizationCode.findOne({
      codeHash: hashToken(authorizationCode),
      clientId: client.client_id,
    }).lean();
    if (!record || record.used || record.expiresAt < new Date()) {
      throw new InvalidGrantError('Code d\'autorisation invalide ou expiré.');
    }
    return record.codeChallenge;
  }

  async exchangeAuthorizationCode(client, authorizationCode, _codeVerifier, redirectUri, resource) {
    const codeHash = hashToken(authorizationCode);
    // Atomique : une seule requête concurrente peut gagner ce
    // findOneAndUpdate (filtre `used: false` dans la même opération que le
    // $set) — deux requêtes simultanées avec le même code ne peuvent plus
    // toutes les deux passer avant qu'aucune n'ait eu le temps de marquer
    // `used`, contrairement à un findOne() suivi d'un save() séparé.
    const record = await AuthorizationCode.findOneAndUpdate(
      { codeHash, clientId: client.client_id, used: false, expiresAt: { $gt: new Date() } },
      { $set: { used: true } }
    );
    if (!record) {
      throw new InvalidGrantError('Code d\'autorisation invalide, expiré ou déjà utilisé.');
    }
    if (redirectUri && redirectUri !== record.redirectUri) {
      throw new InvalidGrantError('redirect_uri ne correspond pas à celui de la demande d\'autorisation.');
    }
    if (resource && !this.#resourceMatches(resource)) {
      throw new InvalidTargetError('resource ne correspond pas à ce serveur MCP.');
    }

    return this.#issueTokens(client.client_id, record.userId, record.scopes, crypto.randomUUID());
  }

  async exchangeRefreshToken(client, refreshToken, scopes, resource) {
    if (resource && !this.#resourceMatches(resource)) {
      throw new InvalidTargetError('resource ne correspond pas à ce serveur MCP.');
    }
    const tokenHash = hashToken(refreshToken);

    // Rotation atomique : seule une requête concurrente peut gagner ce
    // findOneAndUpdate (filtre `revokedAt: null` dans la même opération que
    // le $set), contrairement à un findOne() + save() séparé qui laissait
    // deux requêtes simultanées émettre chacune une paire de tokens valide
    // à partir du même refresh token censé être à usage unique.
    const record = await RefreshToken.findOneAndUpdate(
      { tokenHash, clientId: client.client_id, revokedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { revokedAt: new Date() } }
    );
    if (!record) {
      // Invalide/expiré, ou déjà révoqué — dans ce dernier cas, c'est une
      // vraie réutilisation (signe probable de vol) : toute la chaîne
      // (même familyId) est révoquée, pas seulement ce token précis.
      const existing = await RefreshToken.findOne({ tokenHash, clientId: client.client_id }).lean();
      if (existing?.revokedAt) {
        await RefreshToken.updateMany(
          { familyId: existing.familyId, revokedAt: null },
          { $set: { revokedAt: new Date() } }
        );
      }
      throw new InvalidGrantError('Refresh token invalide, expiré ou déjà utilisé — toute la session a été révoquée par sécurité le cas échéant.');
    }

    return this.#issueTokens(client.client_id, record.userId, scopes || record.scopes, record.familyId);
  }

  async verifyAccessToken(token) {
    if (!JWT_SECRET) throw new Error('MCP_OAUTH_JWT_SECRET non configuré.');
    // algorithms épinglé explicitement : sans ça, jsonwebtoken accepte tout
    // algorithme présent dans le header du token, pas seulement celui
    // utilisé à la signature — défense en profondeur contre les attaques de
    // confusion d'algorithme.
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }); // lève si invalide/expiré
    if (payload.aud !== this.resourceUrl) {
      throw new Error('Audience invalide pour cet access token.');
    }
    return {
      token,
      clientId: payload.client_id,
      scopes: payload.scopes || [],
      expiresAt: payload.exp,
      resource: new URL(this.resourceUrl),
      extra: { userId: payload.sub },
    };
  }

  async revokeToken(client, request) {
    const tokenHash = hashToken(request.token);
    if (request.token_type_hint === 'access_token') {
      // Les access tokens sont des JWT auto-portants, non révocables
      // individuellement avant leur expiration naturelle (1h) — voir la
      // note dans la doc. Rien à faire ici, ce n'est pas une erreur.
      return;
    }
    await RefreshToken.updateOne(
      { tokenHash, clientId: client.client_id, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
  }

  // ── Consentement (en dehors de l'interface OAuthServerProvider, appelé
  // directement par les routes /oauth-continue et /oauth-consent) ──

  async createAuthorizationCode(pendingId) {
    const pending = await PendingAuthorization.findById(pendingId);
    if (!pending || !pending.userId || pending.expiresAt < new Date()) {
      throw new Error('Autorisation en attente introuvable ou expirée.');
    }

    const code = generateOpaqueToken();
    await AuthorizationCode.create({
      codeHash: hashToken(code),
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      codeChallenge: pending.codeChallenge,
      resource: pending.resource,
      scopes: pending.scopes,
      userId: pending.userId,
      expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
    });

    await PendingAuthorization.deleteOne({ _id: pendingId });

    const redirectUrl = new URL(pending.redirectUri);
    redirectUrl.searchParams.set('code', code);
    if (pending.state) redirectUrl.searchParams.set('state', pending.state);
    return redirectUrl.href;
  }

  async denyAuthorization(pendingId) {
    const pending = await PendingAuthorization.findById(pendingId);
    if (!pending) throw new Error('Autorisation en attente introuvable ou expirée.');
    await PendingAuthorization.deleteOne({ _id: pendingId });

    const redirectUrl = new URL(pending.redirectUri);
    redirectUrl.searchParams.set('error', 'access_denied');
    if (pending.state) redirectUrl.searchParams.set('state', pending.state);
    return redirectUrl.href;
  }

  async #issueTokens(clientId, userId, scopes, familyId) {
    // Jamais l'opdsToken dans le JWT : un JWT n'est signé, pas chiffré,
    // donc lisible par quiconque le détient (le client MCP lui-même) — n'y
    // mettre qu'un identifiant opaque (userId) annule l'intérêt d'un
    // access token de courte durée si le vrai credential permanent
    // (opdsToken) y était inclus en clair. verifyAccessToken() résout
    // l'opdsToken côté serveur à partir du userId à chaque appel (avec
    // cache mémoire court, voir backendClient.js) — bonus : une
    // régénération de l'opdsToken par l'utilisateur est prise en compte
    // automatiquement, sans invalider les sessions OAuth en cours.
    const jti = crypto.randomUUID();
    const accessToken = jwt.sign(
      { sub: userId, client_id: clientId, scopes, jti },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: ACCESS_TOKEN_TTL_S, audience: this.resourceUrl }
    );

    const refreshToken = generateOpaqueToken();
    await RefreshToken.create({
      tokenHash: hashToken(refreshToken),
      clientId,
      userId,
      familyId,
      scopes,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    });

    // Vérifie dès l'émission que l'utilisateur a bien un opdsToken
    // exploitable (échoue tôt plutôt qu'au premier appel d'outil MCP).
    await resolveOpdsToken(userId);

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_S,
      refresh_token: refreshToken,
      scope: (scopes || []).join(' ') || undefined,
    };
  }
}
