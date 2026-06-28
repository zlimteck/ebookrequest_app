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
    enum: ['password', 'passkey', 'invitation', '2fa'],
    default: 'password',
  },
  lastActivity: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
}, {
  timestamps: true,
});

// TTL index : MongoDB supprime automatiquement les sessions expirées
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// Index pour lister les sessions d'un user efficacement
sessionSchema.index({ userId: 1, expiresAt: 1 });

export default mongoose.model('Session', sessionSchema);
