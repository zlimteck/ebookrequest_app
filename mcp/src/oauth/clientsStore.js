import OAuthClient from '../models/OAuthClient.js';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// HTTPS obligatoire pour les redirect_uris, sauf exception loopback (tests
// locaux / clients natifs, RFC 8252 §7.3 — déjà géré pour la mise en
// correspondance côté SDK, mais pas pour cette validation à l'enregistrement).
function isAllowedRedirectUri(uriStr) {
  let uri;
  try {
    uri = new URL(uriStr);
  } catch {
    return false;
  }
  if (uri.protocol === 'https:') return true;
  if (uri.protocol === 'http:' && LOOPBACK_HOSTS.has(uri.hostname)) return true;
  return false;
}

function toClientInformationFull(doc) {
  return {
    client_id: doc.client_id,
    client_secret: doc.client_secret,
    client_secret_expires_at: doc.client_secret_expires_at,
    client_id_issued_at: doc.client_id_issued_at,
    client_name: doc.client_name,
    redirect_uris: doc.redirect_uris,
    grant_types: doc.grant_types,
    response_types: doc.response_types,
    token_endpoint_auth_method: doc.token_endpoint_auth_method,
  };
}

export const clientsStore = {
  async getClient(clientId) {
    const doc = await OAuthClient.findOne({ client_id: clientId }).lean();
    return doc ? toClientInformationFull(doc) : undefined;
  },

  // Appelé par le handler /register du SDK, qui a déjà généré
  // client_id/client_secret/client_id_issued_at (voir handlers/register.js)
  // et validé la forme générale des métadonnées (schéma Zod) — on applique
  // ici nos propres règles métier (HTTPS obligatoire) puis on persiste tel
  // quel. La liste des callbacks de clients MCP (dont Claude) n'est jamais
  // codée en dur : seule la règle générique ci-dessus les valide.
  async registerClient(clientInfo) {
    const redirectUris = clientInfo.redirect_uris || [];
    if (redirectUris.length === 0) {
      throw new Error('Au moins un redirect_uri est requis.');
    }
    if (!redirectUris.every(isAllowedRedirectUri)) {
      throw new Error('Tous les redirect_uris doivent être en HTTPS (http://localhost accepté pour les tests).');
    }

    const doc = await OAuthClient.create({
      client_id: clientInfo.client_id,
      client_secret: clientInfo.client_secret,
      client_secret_expires_at: clientInfo.client_secret_expires_at,
      client_id_issued_at: clientInfo.client_id_issued_at,
      client_name: clientInfo.client_name || '',
      redirect_uris: redirectUris,
      grant_types: clientInfo.grant_types,
      response_types: clientInfo.response_types,
      token_endpoint_auth_method: clientInfo.token_endpoint_auth_method,
    });

    return toClientInformationFull(doc);
  },
};
