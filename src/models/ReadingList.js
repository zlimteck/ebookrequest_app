import mongoose from 'mongoose';

const readingListSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  author: { type: String, required: true },
  thumbnail: { type: String, default: '' },
  googleBooksId: { type: String, default: '' },
  status: { type: String, enum: ['unread', 'read'], default: 'unread' },
  source: { type: String, enum: ['manual', 'request'], default: 'manual' },
  requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'BookRequest' },
  readAt: { type: Date, default: null },
  rating: { type: Number, min: 0, max: 5, default: 0 },
}, { timestamps: true });

// Index pour éviter les doublons par demande
readingListSchema.index({ userId: 1, requestId: 1 }, { unique: true, sparse: true });
readingListSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model('ReadingList', readingListSchema);