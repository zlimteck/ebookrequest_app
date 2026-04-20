import mongoose from 'mongoose';

const pushSubscriptionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  subscription: {
    endpoint: { type: String, required: true },
    keys: {
      p256dh: { type: String, required: true },
      auth:   { type: String, required: true }
    }
  }
}, { timestamps: true });

// Index pour retrouver rapidement les souscriptions d'un user
pushSubscriptionSchema.index({ user: 1 });
// Index unique sur endpoint pour éviter les doublons
pushSubscriptionSchema.index({ 'subscription.endpoint': 1 }, { unique: true });

export default mongoose.model('PushSubscription', pushSubscriptionSchema);