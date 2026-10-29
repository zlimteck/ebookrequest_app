import mongoose from 'mongoose';

// Connexion Mongo dédiée pour mcp/ (service séparé du backend principal,
// voir feat/mcp-oauth) — même cluster/base que EbookRequest (MONGODB_URI
// partagée), mais seulement les collections OAuth propres à ce service
// (jamais User/Session, jamais touché directement ici : l'identité et les
// opdsToken restent résolus via le backend principal).
let connected = false;

export async function connectDb() {
  if (connected) return;
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI est requis pour le flux OAuth MCP.');
  }
  await mongoose.connect(uri);
  connected = true;
  console.log('[MCP OAuth] Connecté à MongoDB');
}
