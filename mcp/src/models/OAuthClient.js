import mongoose from 'mongoose';

// client_secret est stocké en clair : le middleware authenticateClient du
// SDK officiel (server/auth/middleware/clientAuth.js) fait une comparaison
// directe `client.client_secret !== client_secret` et s'attend à ce que
// getClient() renvoie la valeur exploitable telle quelle — le hacher ici
// casserait ce comparateur sans qu'on puisse le remplacer sans réécrire tout
// le handler /token. Risque jugé acceptable : un client_secret OAuth n'est
// pas un mot de passe utilisateur (même tolérance déjà en place pour
// User.opdsToken côté backend principal, stocké en clair pour la même
// raison de lookup direct).
const oauthClientSchema = new mongoose.Schema({
  client_id: { type: String, required: true, unique: true },
  client_secret: { type: String, default: undefined },
  client_secret_expires_at: { type: Number, default: undefined },
  client_id_issued_at: { type: Number, required: true },
  client_name: { type: String, default: '' },
  redirect_uris: { type: [String], required: true },
  grant_types: { type: [String], default: ['authorization_code', 'refresh_token'] },
  response_types: { type: [String], default: ['code'] },
  token_endpoint_auth_method: { type: String, default: 'none' },
}, { timestamps: true, collection: 'mcp_oauth_clients' });

export default mongoose.model('McpOAuthClient', oauthClientSchema);
