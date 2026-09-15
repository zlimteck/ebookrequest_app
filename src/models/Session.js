import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  ip: { type: String, default: '' },
  userAgent: { type: String, default: '' },
  loginMethod: {
    type: String,
    enum: ['password', 'passkey', 'invitation', '2fa', 'token'],
    default: 'password',
  },
  // Identifiant stable d'appareil pour les sessions de type 'token' (opdsToken :
  // app iOS, OPDS, MCP...) — dérivé de userId+user-agent (voir auth.js), permet de
  // retrouver/rafraîchir la même session à chaque requête au lieu d'en créer une
  // nouvelle à chaque fois. Non chiffré (contrairement à `userAgent` ci-dessus)
  // car utilisé comme clé de recherche déterministe ; `userAgent` reste chiffré
  // pour l'affichage (AES-CBC en IV aléatoire, donc pas exploitable comme clé).
  deviceKey: { type: String, default: '' },
  // Sessions 'token' uniquement : révocation "douce" (le document est gardé pour
  // que le chemin token de auth.js puisse la reconnaître et bloquer l'accès),
  // contrairement aux autres types de session où DELETE supprime réellement le
  // document (suffisant car le JWT est vérifié via son sid, jamais réémis seul).
  revokedAt: { type: Date, default: null },
  lastActivity: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
}, {
  timestamps: true,
});

// TTL index : MongoDB supprime automatiquement les sessions expirées
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// Index pour lister les sessions d'un user efficacement
sessionSchema.index({ userId: 1, expiresAt: 1 });
// Index pour retrouver/upserter la session d'un appareil (sessions 'token')
sessionSchema.index({ userId: 1, loginMethod: 1, deviceKey: 1 });

export default mongoose.model('Session', sessionSchema);
