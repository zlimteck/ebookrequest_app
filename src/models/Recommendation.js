import mongoose from 'mongoose';

const MAX_REGENERATIONS = 3;
const WINDOW_DAYS = 7;

const RecommendationSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  recommendations: [{ type: mongoose.Schema.Types.Mixed }],
  generatedAt: { type: Date, default: Date.now },
  // Fenêtre glissante de régénération
  regenerationCount: { type: Number, default: 0 }, // nb de régénérations dans la fenêtre courante
  windowStart: { type: Date, default: Date.now },  // début de la fenêtre courante
}, { timestamps: false });

RecommendationSchema.index({ user: 1 });

// ── Helpers ──────────────────────────────────────────────────────────────────

RecommendationSchema.methods.isWindowExpired = function () {
  const windowMs = WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return Date.now() - this.windowStart.getTime() > windowMs;
};

RecommendationSchema.methods.resetWindowIfExpired = function () {
  if (this.isWindowExpired()) {
    this.regenerationCount = 0;
    this.windowStart = new Date();
  }
};

RecommendationSchema.methods.canRegenerate = function () {
  this.resetWindowIfExpired();
  return this.regenerationCount < MAX_REGENERATIONS;
};

RecommendationSchema.methods.getRateLimitInfo = function () {
  this.resetWindowIfExpired();
  const windowResetAt = new Date(this.windowStart.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return {
    regenerationsUsed: this.regenerationCount,
    regenerationsMax: MAX_REGENERATIONS,
    regenerationsRemaining: Math.max(0, MAX_REGENERATIONS - this.regenerationCount),
    windowResetAt,
  };
};

export { MAX_REGENERATIONS, WINDOW_DAYS };
export default mongoose.model('Recommendation', RecommendationSchema);