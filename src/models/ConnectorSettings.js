import mongoose from 'mongoose';

const ConnectorSettingsSchema = new mongoose.Schema({
  service: { type: String, required: true, unique: true },
  enabled: { type: Boolean, default: false },
  url:    { type: String, default: '' },
  apiKey: { type: String, default: '' },
  username: { type: String, default: '' },
  password: { type: String, default: '' },
  lang:   { type: String, default: '' },
  cronInterval: { type: Number, default: 6 },
  valentineFallbackToAdmin: { type: Boolean, default: false },
  // Préférences emails admin (service: 'email')
  emailEnabled:        { type: Boolean, default: true },
  notifyOnNewRequest:  { type: Boolean, default: true },
}, { timestamps: true });

export default mongoose.model('ConnectorSettings', ConnectorSettingsSchema);