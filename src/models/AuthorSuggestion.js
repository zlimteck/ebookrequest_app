import mongoose from 'mongoose';

// Cache des suggestions d'auteurs à suivre, générées une fois puis
// réutilisées (pas de régénération manuelle).
const AuthorSuggestionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  suggestions: [{ type: mongoose.Schema.Types.Mixed }],
  generatedAt: { type: Date, default: Date.now },
}, { timestamps: false });

AuthorSuggestionSchema.index({ user: 1 });

export default mongoose.model('AuthorSuggestion', AuthorSuggestionSchema);
