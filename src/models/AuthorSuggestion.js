import mongoose from 'mongoose';
import { MAX_REGENERATIONS, WINDOW_DAYS } from './Recommendation.js';

// Même mécanique de cache + quota de régénération que Recommendation.js (3
// régénérations par 7 jours), appliquée aux suggestions d'auteurs à suivre
// plutôt qu'aux recommandations de livres.
const AuthorSuggestionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  suggestions: [{ type: mongoose.Schema.Types.Mixed }],
  generatedAt: { type: Date, default: Date.now },
  regenerationCount: { type: Number, default: 0 },
  windowStart: { type: Date, default: Date.now },
}, { timestamps: false });

AuthorSuggestionSchema.index({ user: 1 });

AuthorSuggestionSchema.methods.isWindowExpired = function () {
  const windowMs = WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() - this.windowStart.getTime() > windowMs;
};

AuthorSuggestionSchema.methods.resetWindowIfExpired = function () {
  if (this.isWindowExpired()) {
    this.regenerationCount = 0;
    this.windowStart = new Date();
  }
};

AuthorSuggestionSchema.methods.canRegenerate = function () {
  this.resetWindowIfExpired();
  return this.regenerationCount < MAX_REGENERATIONS;
};

AuthorSuggestionSchema.methods.getRateLimitInfo = function () {
  this.resetWindowIfExpired();
  const windowResetAt = new Date(this.windowStart.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return {
    regenerationsUsed: this.regenerationCount,
    regenerationsMax: MAX_REGENERATIONS,
    regenerationsRemaining: Math.max(0, MAX_REGENERATIONS - this.regenerationCount),
    windowResetAt,
  };
};

export default mongoose.model('AuthorSuggestion', AuthorSuggestionSchema);
