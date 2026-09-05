/**
 * Migration : calibreWeb.shelfName (string unique) → calibreWeb.shelves[]
 * (tableau { name, isDefault }), pour supporter le multi-étagères.
 *
 * Additive et non-destructive à dessein : shelfName n'est JAMAIS supprimé.
 * La base étant partagée entre l'atelier de test et la prod, et la prod
 * tournant encore sur l'ancien code (qui lit shelfName directement), toucher
 * à ce champ casserait silencieusement l'ajout à l'étagère en prod tant que
 * le nouveau code n'y est pas déployé. En le laissant intact :
 *  - la prod n'est impactée en rien, avant ni après ce script
 *  - un rollback complet tient en une commande, à tout moment :
 *      db.users.updateMany({}, { $unset: { "calibreWeb.shelves": "" } })
 * Le nettoyage de l'ancien champ shelfName se fera plus tard, séparément,
 * une fois le nouveau code déployé partout et validé.
 *
 * Usage : docker exec -it ebookrequest-backend npm run migrate-calibre-shelves
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI manquant');
  process.exit(1);
}

// Schéma non strict : on veut pouvoir lire l'ancien champ shelfName même s'il
// n'existe plus dans le modèle User.js actuel.
const userSchema = new mongoose.Schema({}, { strict: false });
const User = mongoose.models.User || mongoose.model('User', userSchema, 'users');

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connecté à MongoDB');

  const users = await User.find(
    { 'calibreWeb.shelfName': { $exists: true } },
    { calibreWeb: 1 }
  );
  console.log(`👤 ${users.length} utilisateur(s) avec un ancien champ shelfName`);

  let migrated = 0, skipped = 0, errors = 0;

  for (const user of users) {
    try {
      const oldName = (user.calibreWeb?.shelfName || '').trim();
      const alreadyHasShelves = Array.isArray(user.calibreWeb?.shelves) && user.calibreWeb.shelves.length > 0;

      if (alreadyHasShelves) {
        // Déjà migré (ou déjà configuré manuellement) — rien à faire.
        skipped++;
        continue;
      }

      const shelves = oldName ? [{ name: oldName, isDefault: true }] : [];
      await User.updateOne(
        { _id: user._id },
        { $set: { 'calibreWeb.shelves': shelves } }
      );
      migrated++;
      console.log(`  ✓ ${user.username || user._id} : ${oldName ? `"${oldName}" → étagère par défaut` : '(aucune étagère configurée)'}`);
    } catch (err) {
      console.error(`  ❌ Erreur pour ${user.username || user._id} :`, err.message);
      errors++;
    }
  }

  console.log(`\n✅ Migration terminée :`);
  console.log(`   Migrés   : ${migrated}`);
  console.log(`   Ignorés  : ${skipped} (déjà migrés)`);
  console.log(`   Erreurs  : ${errors}`);
  console.log(`\nℹ️  L'ancien champ shelfName n'a pas été touché (par sécurité, base partagée avec la prod).`);
  console.log(`   Rollback complet si besoin : db.users.updateMany({}, { $unset: { "calibreWeb.shelves": "" } })`);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error('❌ Erreur fatale :', err);
  process.exit(1);
});
