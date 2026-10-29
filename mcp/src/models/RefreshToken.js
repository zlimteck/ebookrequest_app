import mongoose from 'mongoose';

// Rotation à chaque usage : un refresh token déjà utilisé une fois reste en
// base (revokedAt renseigné) pour pouvoir détecter une réutilisation (vol de
// token) et révoquer toute la chaîne via familyId — jamais supprimé à la
// rotation elle-même, seulement à l'expiration (TTL) ou sur révocation
// explicite de la chaîne entière.
const refreshTokenSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true },
  clientId: { type: String, required: true },
  userId: { type: String, required: true },
  familyId: { type: String, required: true },
  scopes: { type: [String], default: [] },
  revokedAt: { type: Date, default: null },
  expiresAt: { type: Date, required: true },
}, { timestamps: true, collection: 'mcp_oauth_refresh_tokens' });

refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
refreshTokenSchema.index({ familyId: 1 });

export default mongoose.model('McpRefreshToken', refreshTokenSchema);
