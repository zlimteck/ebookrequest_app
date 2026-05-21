/**
 * Migration : importer toutes les requêtes existantes dans la liste de lecture.
 * Usage : docker exec -it ebookrequest-backend npm run migrate-reading-list
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI manquant');
  process.exit(1);
}

// ── Schémas inline pour éviter les dépendances circulaires ──

const bookRequestSchema = new mongoose.Schema({
  user: mongoose.Schema.Types.ObjectId,
  title: String,
  author: String,
  thumbnail: { type: String, default: '' },
}, { strict: false });

const readingListSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, required: true },
  title:       { type: String, required: true },
  author:      { type: String, required: true },
  thumbnail:   { type: String, default: '' },
  googleBooksId: { type: String, default: '' },
  status:      { type: String, enum: ['unread', 'read'], default: 'unread' },
  source:      { type: String, enum: ['manual', 'request'], default: 'manual' },
  requestId:   { type: mongoose.Schema.Types.ObjectId, default: null },
  readAt:      { type: Date, default: null },
}, { timestamps: true });

readingListSchema.index({ userId: 1, requestId: 1 }, { unique: true, sparse: true });

const BookRequest = mongoose.models.BookRequest
  || mongoose.model('BookRequest', bookRequestSchema);
const ReadingList = mongoose.models.ReadingList
  || mongoose.model('ReadingList', readingListSchema);

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connecté à MongoDB');

  const requests = await BookRequest.find({}, 'user title author thumbnail');
  console.log(`📚 ${requests.length} requête(s) trouvée(s)`);

  let added = 0, skipped = 0, errors = 0;

  for (const req of requests) {
    if (!req.user || !req.title || !req.author) { skipped++; continue; }
    try {
      await ReadingList.create({
        userId: req.user,
        title: req.title.trim(),
        author: req.author.trim(),
        thumbnail: req.thumbnail || '',
        source: 'request',
        requestId: req._id,
        status: 'unread',
      });
      added++;
    } catch (err) {
      if (err.code === 11000) {
        skipped++; // déjà présent
      } else {
        console.error(`  ❌ Erreur pour "${req.title}":`, err.message);
        errors++;
      }
    }
  }

  console.log(`\n✅ Migration terminée :`);
  console.log(`   Ajoutés  : ${added}`);
  console.log(`   Ignorés  : ${skipped} (déjà présents ou données incomplètes)`);
  console.log(`   Erreurs  : ${errors}`);

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(err => {
  console.error('❌ Erreur fatale :', err);
  process.exit(1);
});
