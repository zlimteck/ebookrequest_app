import mongoose from 'mongoose';

const adminLogSchema = new mongoose.Schema({
  // Optionnel : absent pour les entrées générées par une tâche de fond (cron),
  // qui n'a pas d'utilisateur associé — adminUsername vaut alors "Système".
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  adminUsername: { type: String, required: true },
  action: {
    type: String,
    enum: ['cancel', 'complete', 'delete', 'comment', 'status_change', 'upload', 'resolve_report', 'settings_change', 'account_deleted', 'cron_run'],
    required: true
  },
  requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'BookRequest' },
  requestTitle: { type: String },
  targetUser: { type: String },
  details: { type: String }
}, {
  timestamps: true
});

adminLogSchema.index({ createdAt: -1 });
// Auto-suppression des logs après 90 jours
adminLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export default mongoose.model('AdminLog', adminLogSchema);