import mongoose from 'mongoose';

// Jetons APNs (push natif iOS) — distinct de `PushSubscription` (Web Push/VAPID, navigateurs).
const deviceTokenSchema = new mongoose.Schema({
  user:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  token: { type: String, required: true },
}, { timestamps: true });

deviceTokenSchema.index({ user: 1 });
// Un même appareil ne doit apparaître qu'une fois, y compris si un autre utilisateur
// s'était connecté dessus auparavant (upsert par token, pas par couple user+token).
deviceTokenSchema.index({ token: 1 }, { unique: true });

export default mongoose.model('DeviceToken', deviceTokenSchema);
