import mongoose from 'mongoose';

// Abonnement d'un utilisateur à un auteur (issue #48). La vérification des
// nouveautés elle-même vit sur Author (un seul check par auteur et par cycle
// de cron, pas par abonnement) — ce document ne porte que la préférence
// propre à l'utilisateur.
const authorFollowSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'Author', required: true },
  autoRequest: { type: Boolean, default: false },
  // Synchro avec le compte Hardcover personnel de l'utilisateur (même format
  // que ReadingList.hardcoverSync) — voir hardcoverAuthorSyncService.js.
  hardcoverSync: {
    status:   { type: String, enum: ['synced', 'error', null], default: null },
    syncedAt: { type: Date, default: null },
    error:    { type: String, default: '' },
  },
  // 'hardcover' si cet abonnement vient d'un import depuis Hardcover plutôt
  // que d'un suivi créé localement (même convention que ReadingList.importedFrom).
  importedFrom: { type: String, default: '' },
}, { timestamps: true });

authorFollowSchema.index({ user: 1, author: 1 }, { unique: true });

export default mongoose.model('AuthorFollow', authorFollowSchema);
