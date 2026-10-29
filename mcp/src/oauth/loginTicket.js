import jwt from 'jsonwebtoken';
import ConsumedLoginTicket from '../models/ConsumedLoginTicket.js';

const SECRET = process.env.MCP_LOGIN_TICKET_SECRET;
// Marge au-delà de l'expiration du ticket (60s côté backend) avant de
// purger l'entrée de consommation — juste assez pour couvrir une petite
// dérive d'horloge entre les deux conteneurs, pas plus.
const CONSUMED_TTL_MS = 2 * 60 * 1000;

/**
 * Vérifie et consomme un ticket de login émis par POST /api/auth/mcp-login-ticket.
 * Lève une erreur si le ticket est invalide, expiré, ou déjà utilisé.
 * Retourne l'id de l'utilisateur authentifié.
 */
export async function consumeLoginTicket(ticket) {
  if (!SECRET) throw new Error('MCP_LOGIN_TICKET_SECRET non configuré.');
  if (!ticket) throw new Error('Ticket manquant.');

  let payload;
  try {
    // algorithms épinglé explicitement, même raison que provider.js#verifyAccessToken.
    payload = jwt.verify(ticket, SECRET, { algorithms: ['HS256'] });
  } catch {
    throw new Error('Ticket invalide ou expiré.');
  }
  if (!payload.sub || !payload.jti) {
    throw new Error('Ticket malformé.');
  }

  // Insertion atomique : l'index unique sur `jti` fait échouer toute 2e
  // tentative avec le même ticket (rejeu), sans lecture-puis-écriture qui
  // laisserait une fenêtre de course.
  try {
    await ConsumedLoginTicket.create({
      jti: payload.jti,
      expiresAt: new Date(Date.now() + CONSUMED_TTL_MS),
    });
  } catch (err) {
    if (err?.code === 11000) throw new Error('Ticket déjà utilisé.');
    throw err;
  }

  return String(payload.sub);
}
