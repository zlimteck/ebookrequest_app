import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['deleted', 'resolved', 'new_request', 'request_completed'],
    required: true
  },
  title: { type: String, required: true },
  author: { type: String, default: '' },
  message: { type: String, default: '' },
  seen: { type: Boolean, default: false },
  seenAt: { type: Date }
}, {
  timestamps: true
});

notificationSchema.index({ user: 1, seen: 1 });
// Auto-suppression après 30 jours une fois la notification vue
notificationSchema.index({ seenAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60, partialFilterExpression: { seen: true } });

export default mongoose.model('Notification', notificationSchema);