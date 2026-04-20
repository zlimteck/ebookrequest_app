import mongoose from 'mongoose';

const aiRequestLogSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  username: {
    type: String,
    required: true
  },
  requestType: {
    type: String,
    enum: ['recommendation', 'bestseller', 'other'],
    required: true
  },
  provider: {
    type: String,
    enum: ['openai', 'ollama', 'other'],
    required: true,
    default: 'ollama' // Default for existing documents
  },
  model: {
    type: String,
    required: true
  },
  success: {
    type: Boolean,
    required: true,
    default: false
  },
  errorMessage: {
    type: String,
    default: null
  },
  responseTime: {
    type: Number, // en millisecondes
    default: null
  },
  tokensUsed: {
    type: Number,
    default: null
  }
}, {
  timestamps: true
});

// Index pour les recherches par utilisateur et date
aiRequestLogSchema.index({ userId: 1, createdAt: -1 });
aiRequestLogSchema.index({ createdAt: -1 });
aiRequestLogSchema.index({ success: 1 });
aiRequestLogSchema.index({ requestType: 1 });
aiRequestLogSchema.index({ provider: 1 });
aiRequestLogSchema.index({ provider: 1, success: 1 });

export default mongoose.model('AIRequestLog', aiRequestLogSchema);