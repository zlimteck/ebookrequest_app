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
  // Génération/rafraîchissement automatiques en tâche de fond (crons) — activés
  // par défaut pour ne rien changer au comportement existant, désactivables
  // individuellement par un admin qui préfère tout déclencher manuellement.
  bestsellerAutoGenerate:     { type: Boolean, default: true },
  recommendationsAutoRefresh: { type: Boolean, default: true },
  // Provider Email (service: 'emailProvider') — 'smtp' | 'resend'
  smtpHost:   { type: String, default: '' },
  smtpPort:   { type: Number, default: 0 },
  smtpSecure: { type: Boolean, default: false },
  fromAddress:{ type: String, default: '' },
  fromName:   { type: String, default: '' },
  // Secret de signature des webhooks Resend (SVIX) — chiffré via cryptoService,
  // remplace process.env.RESEND_WEBHOOK_SECRET pour pouvoir être changé sans
  // redéploiement.
  resendWebhookSecret: { type: String, default: '' },
  cronInterval: { type: Number, default: 6 },
  valentineFallbackToAdmin: { type: Boolean, default: false },
  // Recherche directe Valentine (bypass Google Books) — off/on admin, avec
  // avertissement dans l'UI sur le risque de ban lié à l'usage accru du
  // compte Valentine que ça implique. Demande de zlimteck.
  // Opt-in : la recherche directe multiplie les échanges avec Valentine
  // (risque de ban de compte), désactivée tant qu'un admin ne l'active pas explicitement.
  directSearchEnabled: { type: Boolean, default: false },
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
  // Push natif iOS (service: 'apns') — apiKey réutilisé pour le contenu de la clé .p8
  // (chiffré, comme les autres secrets de ce schéma).
  apnsKeyId:      { type: String, default: '' },
  apnsTeamId:     { type: String, default: '' },
  apnsBundleId:   { type: String, default: '' },
  apnsProduction: { type: Boolean, default: true },
  // Mode 'relay' : délègue l'envoi à un relais externe qui détient la vraie clé Apple
  // (utile pour une instance self-hébergée sans compte Apple Developer). apnsRelayToken
  // est chiffré comme apiKey ci-dessus, jamais stocké en clair.
  apnsMode:        { type: String, enum: ['direct', 'relay'], default: 'direct' },
  apnsRelayUrl:    { type: String, default: '' },
  apnsRelayToken:  { type: String, default: '' },
  // Catégories Torznab/Newznab sélectionnées par indexeur (service: 'prowlarr') —
  // { [indexerId]: [categoryId, ...] }. Par défaut vide = toutes les catégories
  // ebook/BD/manga proposées par l'indexeur (voir prowlarrService.js).
  prowlarrIndexerCategories: { type: mongoose.Schema.Types.Mixed, default: {} },
  // Indexeurs désactivés pour la recherche EbookRequest — { [indexerId]: false },
  // indépendant du toggle "enable" propre à Prowlarr (jamais modifié par nous).
  // Absent = activé par défaut.
  prowlarrIndexerSearchEnabled: { type: mongoose.Schema.Types.Mixed, default: {} },
  // Connexion directe au client torrent (service: 'downloadClient') — distincte
  // de ce que Prowlarr connaît lui-même (il ne redonne jamais les identifiants
  // du client vers l'extérieur) : nécessaire pour interroger l'état du
  // téléchargement et récupérer le fichier une fois terminé.
  downloadClientType: { type: String, enum: ['', 'qbittorrent', 'rtorrent', 'deluge', 'transmission'], default: '' },
  downloadClientUsername: { type: String, default: '' },
  // Récupération du fichier terminé : 'local' (volume Docker partagé, lecture
  // directe) ou 'webdav' (serveur distant, HTTP pur) — voir issue #42.
  fileAccessMode: { type: String, enum: ['local', 'webdav'], default: 'local' },
  fileAccessLocalPath: { type: String, default: '' },
  fileAccessWebdavUrl: { type: String, default: '' },
  fileAccessWebdavUsername: { type: String, default: '' },
  // Préfixe à ajouter devant le chemin relatif du fichier sous la racine
  // WebDAV, si le dossier de téléchargement du client n'est pas exposé à la
  // racine (ex: seedbox où /webdav pointe sur le home entier, torrents dans
  // un sous-dossier). Vide par défaut = racine WebDAV = dossier de téléchargement.
  fileAccessWebdavBasePath: { type: String, default: '' },
}, { timestamps: true });

export default mongoose.model('ConnectorSettings', ConnectorSettingsSchema);