import mongoose from 'mongoose';

const adminLogSchema = new mongoose.Schema({
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  adminUsername: { type: String, required: true },
  action: {
    type: String,
    enum: ['cancel', 'complete', 'delete', 'comment', 'status_change', 'upload', 'resolve_report'],
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