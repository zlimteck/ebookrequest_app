import mongoose from 'mongoose';

// Le code d'autorisation réel n'est jamais stocké en clair : seul son hash
// (SHA-256, voir oauth/tokens.js) est persisté, pour qu'une fuite de la base
// ne suffise pas à rejouer un code encore valide (fenêtre de 60s de toute
// façon, mais autant ne pas le stocker en clair pour un coût nul).
// `userId` seulement, jamais l'opdsToken — voir provider.js pour la
// justification (régénération de l'opdsToken sans invalider les sessions
// OAuth en cours).
const authorizationCodeSchema = new mongoose.Schema({
  codeHash: { type: String, required: true, unique: true },
  clientId: { type: String, required: true },
  redirectUri: { type: String, required: true },
  codeChallenge: { type: String, required: true },
  resource: { type: String, default: '' },
  scopes: { type: [String], default: [] },
  userId: { type: String, required: true },
  used: { type: Boolean, default: false },
  expiresAt: { type: Date, required: true },
}, { timestamps: true, collection: 'mcp_oauth_authorization_codes' });

authorizationCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('McpAuthorizationCode', authorizationCodeSchema);
