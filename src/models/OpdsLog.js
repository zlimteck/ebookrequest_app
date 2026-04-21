import mongoose from 'mongoose';

const opdsLogSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  action: { type: String, enum: ['catalog', 'download'], required: true },
  bookRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'BookRequest', default: null },
  bookTitle: { type: String, default: null },
  ip: { type: String },
  userAgent: { type: String },
  client: { type: String }, // parsed from userAgent: 'Kobo', 'Calibre', 'KOReader', 'Other'
  accessedAt: { type: Date, default: Date.now, index: true }
});

// Helper to parse client name from User-Agent
opdsLogSchema.statics.parseClient = function(ua = '') {
  if (!ua) return 'Unknown';
  if (/kobo/i.test(ua)) return 'Kobo';
  if (/calibre/i.test(ua)) return 'Calibre';
  if (/koreader/i.test(ua)) return 'KOReader';
  if (/moon\+/i.test(ua)) return 'Moon+ Reader';
  if (/aldiko/i.test(ua)) return 'Aldiko';
  if (/librera/i.test(ua)) return 'Librera';
  return 'Autre';
};

export default mongoose.model('OpdsLog', opdsLogSchema);