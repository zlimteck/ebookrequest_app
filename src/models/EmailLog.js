import mongoose from 'mongoose';

const emailEventSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'failed'],
    required: true,
  },
  timestamp: { type: Date, default: Date.now },
  data: { type: mongoose.Schema.Types.Mixed }, // données supplémentaires (url cliquée, etc.)
}, { _id: false });

const emailLogSchema = new mongoose.Schema({
  // ID retourné par Resend (null pour SMTP)
  emailId: { type: String, index: true, sparse: true },

  provider: { type: String, enum: ['smtp', 'resend'], required: true },

  to: { type: String, required: true },
  subject: { type: String, required: true },

  // Catégorie de l'email
  type: {
    type: String,
    enum: ['verification', 'password_reset', 'password_changed', 'book_completed', 'book_canceled', 'admin_comment', 'new_request', 'broadcast', 'invitation'],
    required: true,
  },

  // Statut courant
  status: {
    type: String,
    enum: ['sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'failed'],
    default: 'sent',
  },

  sentAt: { type: Date, default: Date.now },

  // Historique des événements (mis à jour via webhook Resend)
  events: [emailEventSchema],

  // Message d'erreur si l'envoi échoue
  error: { type: String },
}, {
  timestamps: true,
});

// Index pour les requêtes fréquentes
emailLogSchema.index({ sentAt: -1 });
emailLogSchema.index({ status: 1, sentAt: -1 });
emailLogSchema.index({ type: 1, sentAt: -1 });

const EmailLog = mongoose.model('EmailLog', emailLogSchema);
export default EmailLog;