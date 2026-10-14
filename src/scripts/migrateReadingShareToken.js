/**
 * Migration : retire la clé readingShare.token des comptes où elle vaut
 * explicitement `null` (ancien `default: null` du schéma User.js).
 *
 * L'index `{ 'readingShare.token': 1 }` est sparse+unique — mais un index
 * sparse ne saute que les documents où le champ est réellement ABSENT,
 * jamais ceux où il vaut `null`. Avec `default: null`, chaque compte n'ayant
 * jamais activé le partage de bibliothèque avait ce champ explicitement à
 * `null`, ce qui fait collisionner la contrainte d'unicité dès qu'il y a 2
 * comptes dans ce cas (trouvé en restaurant une sauvegarde, qui réinsère tous
 * les users d'un coup). Le schéma est corrigé (`default: undefined`) pour les
 * nouveaux comptes ; ce script nettoie les comptes déjà existants.
 *
 * Non-destructif : ne touche jamais les comptes ayant un vrai token (partage
 * actif), seulement ceux où la valeur est `null`.
 * Rollback si besoin : db.users.updateMany({ 'readingShare.enabled': false }, { $set: { 'readingShare.token': null } })
 *
 * Usage : docker exec -it ebookrequest-backend npm run migrate-reading-share-token
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI manquant');
  process.exit(1);
}

const userSchema = new mongoose.Schema({}, { strict: false });
const User = mongoose.models.User || mongoose.model('User', userSchema, 'users');

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connecté à MongoDB');

  const result = await User.updateMany(
    { 'readingShare.token': null },
    { $unset: { 'readingShare.token': '' } }
  );

  console.log(`\n✅ Migration terminée :`);
  console.log(`   Comptes nettoyés : ${result.modifiedCount}`);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error('❌ Erreur fatale :', err);
  process.exit(1);
});
