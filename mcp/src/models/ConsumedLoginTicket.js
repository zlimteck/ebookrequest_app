import mongoose from 'mongoose';

// Empêche la réutilisation d'un ticket de login (jti) émis par le backend
// principal — insertion atomique via l'index unique sur `jti`, la tentative
// de réutilisation échoue sur une erreur de clé dupliquée (voir
// oauth/loginTicket.js), jamais de lecture-puis-écriture non atomique.
const consumedLoginTicketSchema = new mongoose.Schema({
  jti: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true, collection: 'mcp_oauth_consumed_login_tickets' });

consumedLoginTicketSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('McpConsumedLoginTicket', consumedLoginTicketSchema);
