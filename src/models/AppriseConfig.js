import mongoose from 'mongoose';

const appriseConfigSchema = new mongoose.Schema({
  enabled: {
    type: Boolean,
    default: false
  },
  // URLs Apprise (une par ligne) — ex: pover://userKey@apiToken, discord://...
  appriseUrls: {
    type: String,
    default: ''
  },
  notifyOnNewRequest: {
    type: Boolean,
    default: true
  },
  configuredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

export default mongoose.models.AppriseConfig ||
  mongoose.model('AppriseConfig', appriseConfigSchema);