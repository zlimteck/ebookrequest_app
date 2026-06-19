import mongoose from 'mongoose';

const bookRequestSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  username: {
    type: String,
    required: true
  },
  submittedByAdmin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  author: { 
    type: String, 
    required: true 
  },
  title: { 
    type: String, 
    required: true 
  },
  link: { 
    type: String, 
    required: true 
  },
  thumbnail: {
    type: String,
    default: ''
  },
  description: {
    type: String,
    default: ''
  },
  pageCount: {
    type: Number,
    default: 0
  },
  downloadLink: { 
    type: String,
    default: ''
  },
  filePath: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'canceled', 'reported'],
    default: 'pending',
    required: true
  },
  // Suivi des téléchargements
  downloadedAt: {
    type: Date,
    default: null
  },
  // Suivi des notifications vues par l'utilisateur
  notifications: {
    completed: {
      seen: { type: Boolean, default: false },
      seenAt: { type: Date }
    },
    canceled: {
      seen: { type: Boolean, default: false },
      seenAt: { type: Date },
      reason: { type: String }
    },
    reported: {
      seen: { type: Boolean, default: false },
      seenAt: { type: Date }
    },
    adminComment: {
      seen: { type: Boolean, default: false },
      seenAt: { type: Date }
    },
    userComment: {
      seen: { type: Boolean, default: false },
      seenAt: { type: Date }
    }
  },
  completedAt: { type: Date },
  canceledAt: { type: Date },
  cancelReason: { type: String },
  reportedAt: { type: Date },
  reportReason: { type: String },
  adminComment: { type: String, default: '' },
  userComment: { type: String, default: '' },
  comments: [{
    author:    { type: String, required: true },
    role:      { type: String, enum: ['admin', 'user'], required: true },
    text:      { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    seenByUser:  { type: Boolean, default: false },
    seenByAdmin: { type: Boolean, default: false },
  }],
  format: { type: String, enum: ['epub', 'pdf', 'mobi', 'azw3', 'fb2', 'cbz', 'cbr', ''], default: '' },
  category: { type: String, enum: ['ebook', 'comic', 'manga', ''], default: 'ebook' },
  statusHistory: [{
    status: { type: String },
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: String, default: '' },
    note: { type: String, default: '' }
  }],
  lastAutoAttempt: {
    date: { type: Date, default: null },
    connectors: [{ type: String }],
  },
  calibrePush: {
    status:   { type: String, enum: [null, 'success', 'failed'], default: null },
    error:    { type: String, default: null },
    pushedAt: { type: Date, default: null },
  },
  reportSeenByAdmin: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
}, {
  timestamps: true
});

// Index pour les requêtes fréquentes
bookRequestSchema.index({ status: 1 });
bookRequestSchema.index({ createdAt: -1 });

export default mongoose.model('BookRequest', bookRequestSchema);