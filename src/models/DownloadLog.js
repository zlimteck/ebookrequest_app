import mongoose from 'mongoose';

const { Schema } = mongoose;

const downloadLogSchema = new Schema({
  bookRequestId: { type: Schema.Types.ObjectId, ref: 'BookRequest', default: null },
  title:         { type: String, default: '' },
  author:        { type: String, default: '' },
  username:      { type: String, default: '' },
  connector:     { type: String, enum: ['valentine', 'annasarchive', 'manual'], required: true },
  success:       { type: Boolean, required: true },
  error:         { type: String, default: null },
  triggeredBy:   { type: String, enum: ['auto', 'admin'], default: 'auto' },
}, {
  timestamps: true,
});

downloadLogSchema.index({ createdAt: -1 });
downloadLogSchema.index({ connector: 1 });
downloadLogSchema.index({ success: 1 });

export default mongoose.model('DownloadLog', downloadLogSchema);