import mongoose from 'mongoose';

const ConnectorSettingsSchema = new mongoose.Schema({
  service: { type: String, required: true, unique: true },
  enabled: { type: Boolean, default: false },
  url:    { type: String, default: '' },
  apiKey: { type: String, default: '' },
  username: { type: String, default: '' },
  password: { type: String, default: '' },
  lang:   { type: String, default: '' },
  // Provider IA (service: 'aiProvider') — 'openai' | 'ollama' | 'claude'
  provider: { type: String, default: '' },
  model:    { type: String, default: '' },
  // Provider Email (service: 'emailProvider') — 'smtp' | 'resend'
  smtpHost:   { type: String, default: '' },
  smtpPort:   { type: Number, default: 0 },
  smtpSecure: { type: Boolean, default: false },
  fromAddress:{ type: String, default: '' },
  fromName:   { type: String, default: '' },
  cronInterval: { type: Number, default: 6 },
  valentineFallbackToAdmin: { type: Boolean, default: false },
  // Recherche directe Valentine (bypass Google Books) — off/on admin, avec
  // avertissement dans l'UI sur le risque de ban lié à l'usage accru du
  // compte Valentine que ça implique. Demande de zlimteck.
  directSearchEnabled: { type: Boolean, default: true },
  // Anti-spam pour l'alerte "rupture provider" (googleBooks/hardcover) : date de la
  // dernière alerte envoyée pour CE service, pour ne pas réalerter avant 24h tant que
  // le problème persiste.
  lastProviderIssueAlertAt: { type: Date, default: null },
  // Préférences emails admin (service: 'email')
  emailEnabled:          { type: Boolean, default: true },
  notifyOnNewRequest:    { type: Boolean, default: true },
  notifyOnComplete:      { type: Boolean, default: true },
  notifyOnCancel:        { type: Boolean, default: true },
  notifyOnComment:       { type: Boolean, default: true },
  notifyOnReport:        { type: Boolean, default: true },
  notifyOnNewUser:       { type: Boolean, default: true },
  notifyOnDownloadFailed:{ type: Boolean, default: true },
  notifyOnProviderIssue: { type: Boolean, default: true },
  // Préchargement au démarrage du cache "Découvrir"/tendances (service: 'trending')
  preloadOnStartup: { type: Boolean, default: true },
}, { timestamps: true });

export default mongoose.model('ConnectorSettings', ConnectorSettingsSchema);