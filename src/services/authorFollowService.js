import Author from '../models/Author.js';
import AuthorFollow from '../models/AuthorFollow.js';
import BookRequest from '../models/BookRequest.js';
import ConnectorSettings from '../models/ConnectorSettings.js';
import { getAuthorWorks, getAuthorDetails, isLatinScript } from './openLibraryAuthorService.js';

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function getAuthorFollowConfig() {
  const doc = await ConnectorSettings.findOne({ service: 'authorFollow' }).lean();
  return {
    enabled: doc?.enabled ?? true,
    maxAuthorsPerUser: doc?.maxAuthorsPerUser ?? 50,
  };
}

/**
 * Suit un auteur pour un utilisateur. Si l'auteur n'a jamais été suivi par
 * personne, crée le document Author et capture un snapshot de sa
 * bibliographie actuelle (knownBookKeys) — c'est ce snapshot qui empêche
 * authorReleaseCron.js de notifier rétroactivement tout le catalogue
 * existant dès la première vérification.
 */
export async function followAuthor(userId, openLibraryKey, autoRequest = false) {
  const config = await getAuthorFollowConfig();
  if (!config.enabled) throw new Error('Le suivi d\'auteurs est désactivé par l\'administrateur.');

  const currentCount = await AuthorFollow.countDocuments({ user: userId });
  if (config.maxAuthorsPerUser >= 0 && currentCount >= config.maxAuthorsPerUser) {
    throw new Error(`Limite de ${config.maxAuthorsPerUser} auteur(s) suivi(s) atteinte.`);
  }

  let author = await Author.findOne({ openLibraryKey });
  if (!author) {
    const [details, works] = await Promise.all([
      getAuthorDetails(openLibraryKey),
      getAuthorWorks(openLibraryKey),
    ]);
    author = await Author.create({
      openLibraryKey,
      name: details.name,
      bio: details.bio,
      photoUrl: details.photoUrl,
      // Snapshot initial : tout ce qui existe déjà au moment du suivi n'est
      // jamais considéré comme une nouveauté, quelle que soit sa date.
      knownBookKeys: works.map(w => w.workKey),
      lastCheckedAt: new Date(),
    });
  }

  const follow = await AuthorFollow.findOneAndUpdate(
    { user: userId, author: author._id },
    { autoRequest: !!autoRequest },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // Poussé vers le compte Hardcover personnel de l'utilisateur si activé,
  // fire-and-forget — import dynamique pour éviter un cycle statique
  // (hardcoverAuthorSyncService importe authorFollowService pour l'import inverse).
  import('./hardcoverAuthorSyncService.js')
    .then(({ syncAuthorFollowToHardcover }) => syncAuthorFollowToHardcover(userId, follow, author))
    .catch(() => {});

  return { follow, author };
}

export async function unfollowAuthor(userId, openLibraryKey) {
  const author = await Author.findOne({ openLibraryKey });
  if (!author) return;
  await AuthorFollow.deleteOne({ user: userId, author: author._id });

  import('./hardcoverAuthorSyncService.js')
    .then(({ unsyncAuthorFollowFromHardcover }) => unsyncAuthorFollowFromHardcover(userId, author))
    .catch(() => {});
}

export async function updateFollow(userId, openLibraryKey, autoRequest) {
  const author = await Author.findOne({ openLibraryKey });
  if (!author) throw new Error('Auteur introuvable.');
  const follow = await AuthorFollow.findOneAndUpdate(
    { user: userId, author: author._id },
    { autoRequest: !!autoRequest },
    { new: true }
  );
  if (!follow) throw new Error('Abonnement introuvable.');
  return follow;
}

/**
 * Auto-réparation des auteurs suivis avant le correctif du nom latin
 * (`pickBestName`) : leur document Author garde le nom brut stocké une
 * seule fois au moment du suivi, jamais rafraîchi depuis, contrairement à
 * la modale/la recherche qui rappellent toujours Open Library en direct.
 * Rattrapé ici au passage, pas de script de migration à part.
 */
async function healStaleName(author) {
  if (isLatinScript(author.name)) return author;
  try {
    const details = await getAuthorDetails(author.openLibraryKey);
    if (details.name !== author.name || details.bio !== author.bio || details.photoUrl !== author.photoUrl) {
      await Author.updateOne({ _id: author._id }, { name: details.name, bio: details.bio, photoUrl: details.photoUrl });
      return { ...author, name: details.name, bio: details.bio, photoUrl: details.photoUrl };
    }
  } catch {
    // Open Library momentanément indisponible → on garde l'ancien nom plutôt
    // que de faire échouer tout l'affichage de la liste suivie.
  }
  return author;
}

export async function listFollowedAuthors(userId) {
  const follows = await AuthorFollow.find({ user: userId }).populate('author').lean();
  const healed = await Promise.all(
    follows.filter(f => f.author).map(async f => ({ ...f, author: await healStaleName(f.author) }))
  );
  return healed.map(f => ({
    openLibraryKey: f.author.openLibraryKey,
    name: f.author.name,
    photoUrl: f.author.photoUrl,
    bio: f.author.bio,
    autoRequest: f.autoRequest,
    followedAt: f.createdAt,
  }));
}

/**
 * Crée une demande automatique pour une nouvelle sortie détectée par
 * authorReleaseCron.js — même vérifications qu'une demande manuelle
 * (dédup par titre+auteur, quota de l'utilisateur), pour qu'un suivi massif
 * d'auteurs ne contourne pas les limites fixées par l'admin.
 */
export async function createAutoRequestIfEligible(user, { title, author, publishedDate, coverUrl }) {
  if (user.role !== 'admin') {
    const days = user.requestLimitDays ?? 30;
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - days);
    const recentCount = await BookRequest.countDocuments({
      user: user._id,
      createdAt: { $gte: windowStart },
    });
    const limit = user.requestLimit ?? 10;
    if (limit >= 0 && recentCount >= limit) return null;
  }

  const existing = await BookRequest.findOne({
    title: { $regex: `^${escRe(title.trim())}$`, $options: 'i' },
    author: { $regex: `^${escRe(author.trim())}$`, $options: 'i' },
    status: { $nin: ['canceled'] },
  });
  if (existing) return null;

  const request = await BookRequest.create({
    user: user._id,
    username: user.username,
    author,
    title,
    thumbnail: coverUrl || '',
    publishedDate: (publishedDate && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(publishedDate)) ? publishedDate : '',
    category: 'ebook',
    origin: 'author_follow',
    status: 'pending',
    statusHistory: [{ status: 'pending', changedBy: 'système', note: 'Demande créée automatiquement (auteur suivi)' }],
  });
  return request;
}
