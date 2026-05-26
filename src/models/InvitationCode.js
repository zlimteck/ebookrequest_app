import mongoose from 'mongoose';

const InvitationCodeSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
  },
  maxUses: {
    type: Number,
    default: 1,
    min: 0, // 0 = illimité
  },
  usedCount: {
    type: Number,
    default: 0,
  },
  expiresAt: {
    type: Date,
    default: null,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  createdByUsername: {
    type: String,
  },
  usedBy: [
    {
      userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      username: { type: String },
      email:    { type: String },
      usedAt:   { type: Date, default: Date.now },
    },
  ],
}, { timestamps: true });

export default mongoose.model('InvitationCode', InvitationCodeSchema);