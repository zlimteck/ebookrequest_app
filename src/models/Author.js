import mongoose from 'mongoose';

// Catalogue d'auteurs partagé entre tous les utilisateurs (issue #48) — un seul
// document par auteur réel, vérifié une seule fois par cycle de cron quel que
// soit le nombre d'utilisateurs qui le suivent (voir authorReleaseCron.js).
// L'identité stable repose sur la clé Open Library (OL123A), jamais sur le nom
// seul (fragile face aux homonymes).
const authorSchema = new mongoose.Schema({
  openLibraryKey: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  photoUrl: { type: String, default: '' },
  bio: { type: String, default: '' },
  // Enrichissement optionnel si Hardcover est activé par l'admin — jamais
  // utilisé comme identité, seulement pour compléter bio/photo si Open
  // Library n'en a pas.
  hardcoverAuthorId: { type: String, default: '' },
  // Snapshot des livres déjà connus (clés d'œuvre Open Library) au moment du
  // premier suivi — tout ce qui apparaît après compte comme une nouveauté,
  // tout ce qui y était déjà ne déclenche jamais de notification rétroactive.
  knownBookKeys: { type: [String], default: [] },
  lastCheckedAt: { type: Date, default: null },
}, { timestamps: true });

export default mongoose.model('Author', authorSchema);
