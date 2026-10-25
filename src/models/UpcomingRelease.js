import mongoose from 'mongoose';

// Cache des annonces "à paraître" récupérées depuis plusieurs sources (issue
// #52) — contrairement au suivi d'auteurs (issue #48), ce n'est jamais lié à
// un utilisateur ni à un auteur suivi en particulier : c'est une liste
// globale, rafraîchie une fois par jour par upcomingReleasesCron.js.
// Deux sources mutualisées dans le même modèle :
// - 'bnf' : flux RSS public Nouveautés Éditeurs (BnF), couverture quasi
//   toujours absente côté source (icône générique), genre jamais fourni.
// - 'hardcover' : API GraphQL Hardcover, couverture et genre souvent fournis
//   directement par la source, mais catalogue à dominante anglophone — ne
//   recoupe quasiment jamais les parutions françaises de la BnF.
const upcomingReleaseSchema = new mongoose.Schema({
  source: { type: String, enum: ['bnf', 'hardcover'], default: 'bnf', required: true },
  // Identifiant stable côté source (id_declaration BnF, ou id Hardcover) —
  // unique par source, pas globalement (voir index composé ci-dessous).
  externalId: { type: String, required: true },
  title: { type: String, required: true },
  author: { type: String, default: '' },
  publisher: { type: String, default: '' },
  genre: { type: String, default: '' },
  // Vraie date de parution annoncée par la source (jamais une date d'ajout
  // au flux/catalogue, qui ne reflète pas la sortie réelle).
  releaseDate: { type: Date, required: true },
  coverUrl: { type: String, default: '' },
  link: { type: String, default: '' },
}, { timestamps: true });

upcomingReleaseSchema.index({ source: 1, externalId: 1 }, { unique: true });
upcomingReleaseSchema.index({ releaseDate: 1 });

export default mongoose.model('UpcomingRelease', upcomingReleaseSchema);
