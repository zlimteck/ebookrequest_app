import mongoose from 'mongoose';
import crypto from 'crypto';

// Une autorisation en cours, entre le moment où /authorize est appelé et le
// moment où l'utilisateur a fini de se connecter + consentir. Toujours en
// Mongo (jamais en mémoire process) : seul moyen de survivre à un restart du
// conteneur ou à plusieurs replicas, et cohérent avec les autres entités
// OAuth de ce service.
const pendingAuthorizationSchema = new mongoose.Schema({
  _id: { type: String, default: () => crypto.randomUUID() },
  clientId: { type: String, required: true },
  redirectUri: { type: String, required: true },
  codeChallenge: { type: String, required: true },
  resource: { type: String, default: '' },
  state: { type: String, default: '' },
  scopes: { type: [String], default: [] },
  // Renseigné une fois le ticket de login consommé (voir /oauth-continue) ;
  // absent tant que l'utilisateur n'a pas fini de se connecter.
  userId: { type: String, default: null },
  // Jeton anti-CSRF propre à cette autorisation, généré en même temps que
  // userId, vérifié à la soumission du formulaire de consentement.
  csrfToken: { type: String, default: null },
  // Hash d'un secret posé en cookie HttpOnly sur le navigateur qui a
  // initié /authorize (voir provider.js#authorize) — vérifié à
  // /oauth-continue pour s'assurer que c'est bien CE navigateur qui revient,
  // pas un autre à qui le lien /login?continue=... aurait été transmis
  // (sinon : CSRF de login/mix-up, un attaquant démarre son propre
  // /authorize puis fait suivre le lien à une victime déjà connectée, dont
  // le compte se retrouverait lié au client de l'attaquant).
  bindingHash: { type: String, default: null },
  expiresAt: { type: Date, required: true },
}, { timestamps: true, collection: 'mcp_oauth_pending_authorizations', _id: false });

pendingAuthorizationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('McpPendingAuthorization', pendingAuthorizationSchema);
