import mongoose from 'mongoose';

const InvitationSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true },
  token: { type: String, required: true, unique: true },
  status: { type: String, enum: ['pending', 'accepted', 'expired', 'canceled'], default: 'pending' },
  invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  invitedByUsername: { type: String },
  expiresAt: { type: Date, required: true },
  acceptedAt: { type: Date },
}, { timestamps: true });

// Expiration automatique
InvitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.Invitation ||
  mongoose.model('Invitation', InvitationSchema);
