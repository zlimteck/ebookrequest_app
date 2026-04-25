import mongoose from 'mongoose';

const ConnectorSettingsSchema = new mongoose.Schema({
  service: { type: String, required: true, unique: true },
  enabled: { type: Boolean, default: false },
  url:    { type: String, default: '' },
  apiKey: { type: String, default: '' },
  comicVineApiKey: { type: String, default: '' },
  username: { type: String, default: '' },
  password: { type: String, default: '' },
}, { timestamps: true });

export default mongoose.model('ConnectorSettings', ConnectorSettingsSchema);