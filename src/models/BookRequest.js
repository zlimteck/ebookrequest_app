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
  publishedDate: {
    type: String,
    default: ''
  },
  seriesName: {
    type: String,
    default: ''
  },
  seriesIndex: {
    type: Number,
    default: null
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
  // Renseigné quand aucune source automatique n'aboutit : permet d'afficher à l'utilisateur
  // que sa demande passera par un traitement manuel (donc un délai plus long), au lieu de
  // la laisser « en attente » sans explication.
  autoDownloadFailed: {
    at:     { type: Date, default: null },
    reason: { type: String, default: '' },
  },
  // Étagères choisies par l'utilisateur au moment de la demande (case à cocher
  // dans le formulaire de recherche, pré-cochées avec les étagères par défaut
  // de son profil). Si absent/vide (anciennes demandes), on retombe sur les
  // étagères par défaut actuelles de l'utilisateur au moment du push.
  selectedShelves: { type: [String], default: undefined },
  calibrePush: {
    // 'success' : upload ET ajout aux étagères réussis.
    // 'partial' : upload réussi mais au moins une étagère n'a pas pu être
    //             assignée (permet de retenter juste l'étagère, sans réupload).
    // 'failed'  : upload lui-même échoué.
    status:        { type: String, enum: [null, 'success', 'partial', 'failed'], default: null },
    error:         { type: String, default: null },
    pushedAt:      { type: Date, default: null },
    // ID du livre côté Calibre, capturé dès qu'on l'obtient (upload direct ou
    // matching OPDS). Permet au bouton "envoyer vers étagères" a posteriori
    // d'agir directement sans repasser par un upload.
    calibreBookId: { type: Number, default: null },
  },
  // Étagères additionnelles choisies par un admin pour pousser ce même livre
  // vers le compte Calibre-Web d'autres utilisateurs (multishelf multi-users,
  // en plus du push normal vers les étagères de `user`). Chaque cible a son
  // propre statut : ce sont des comptes Calibre-Web distincts, un échec sur
  // l'un ne doit pas affecter les autres.
  extraShelfTargets: {
    type: [{
      user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      username: { type: String, default: '' }, // snapshot pour affichage, même si le compte est supprimé ensuite
      shelves:  { type: [String], default: [] },
      status:   { type: String, enum: [null, 'success', 'partial', 'failed'], default: null },
      error:    { type: String, default: null },
      pushedAt: { type: Date, default: null },
    }],
    default: undefined,
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