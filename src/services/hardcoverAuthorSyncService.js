import User from '../models/User.js';
import Author from '../models/Author.js';
import AuthorFollow from '../models/AuthorFollow.js';
import { decrypt } from './cryptoService.js';
import { graphql } from './hardcoverSyncService.js';
import { searchAuthors } from './openLibraryAuthorService.js';

// Suivi d'auteur <-> Hardcover (issue #48, suite). Pas de mutation officiellement
// documentée pour "suivre un auteur" sur docs.hardcover.app (seul le follow de
// listes/utilisateurs l'est) — insert_follow/delete_follow avec
// followable_type: "Author" confirmés uniquement via du code tiers testé en
// conditions réelles (dustjacket, hardcover.cli). Traité comme risque accepté :
// si Hardcover change cette mutation non documentée, la synchro échouera
// proprement (persist('error', ...)) sans jamais bloquer le suivi côté
// EbookRequest, exactement comme pour la synchro bibliothèque déjà en place.

// Résout l'id Hardcover numérique d'un auteur par son nom, une seule fois par
// auteur partagé (mis en cache sur Author.hardcoverAuthorId, jamais par
// abonnement) — même mutualisation que le reste du suivi d'auteurs.
// Deux étapes, même principe que findHardcoverBookId (hardcoverSyncService.js) :
// 1. Recherche floue via `search` (Typesense, query_type: "Author") pour
//    récupérer le `slug` du meilleur résultat — une clé API personnelle n'a
//    pas accès à une requête directe sur la table `authors` par nom (confirmé
//    en conditions réelles, renvoyait "introuvable" pour des auteurs connus).
// 2. Résolution exacte de l'id réel via `authors(where: { slug: { _eq: ... } })` :
//    l'`id` renvoyé par `search` ne correspond pas à l'id réel en base (même
//    piège que pour les livres, confirmé par l'URL publique .../authors/<slug>).
async function resolveHardcoverAuthorId(apiKey, name) {
  const searchData = await graphql(apiKey, `
    query SearchAuthor($q: String!) {
      search(query: $q, query_type: "Author", per_page: 5, page: 1) { results }
    }
  `, { q: name.trim() });
  const hits = searchData?.search?.results?.hits || [];
  const docs = hits.map(h => h?.document).filter(Boolean);
  const exact = docs.find(d => (d.name || '').trim().toLowerCase() === name.trim().toLowerCase());
  const slug = (exact || docs[0])?.slug;
  if (!slug) return null;

  const data = await graphql(apiKey, `
    query FindAuthorBySlug($slug: String!) {
      authors(where: { slug: { _eq: $slug } }, limit: 1) { id }
    }
  `, { slug });
  return data?.authors?.[0]?.id ?? null;
}

async function getApiKey(userId) {
  const user = await User.findById(userId).select('hardcover');
  if (!user?.hardcover?.enabled || !user?.hardcover?.apiKey) return null;
  return decrypt(user.hardcover.apiKey) ?? user.hardcover.apiKey;
}

const persist = async (authorFollowId, status, error) => {
  await AuthorFollow.updateOne(
    { _id: authorFollowId },
    { $set: { hardcoverSync: { status, syncedAt: new Date(), error: error || '' } } }
  ).catch(() => {});
};

/**
 * Pousse le suivi d'un auteur vers Hardcover (insert_follow). Ne lève jamais,
 * à appeler en fire-and-forget juste après la création d'un AuthorFollow.
 */
export async function syncAuthorFollowToHardcover(userId, authorFollow, author) {
  try {
    const apiKey = await getApiKey(userId);
    if (!apiKey) {
      console.log(`[HardcoverAuthorSync] Synchro ignorée pour "${author?.name}" : service désactivé ou clé absente pour cet utilisateur`);
      return { attempted: false, success: false, error: null };
    }

    let hardcoverAuthorId = author.hardcoverAuthorId || null;
    if (!hardcoverAuthorId) {
      hardcoverAuthorId = await resolveHardcoverAuthorId(apiKey, author.name);
      if (hardcoverAuthorId) {
        await Author.updateOne({ _id: author._id }, { hardcoverAuthorId: String(hardcoverAuthorId) }).catch(() => {});
      }
    }
    if (!hardcoverAuthorId) {
      const error = `Auteur introuvable sur Hardcover pour "${author.name}"`;
      console.warn(`[HardcoverAuthorSync] ${error}`);
      await persist(authorFollow._id, 'error', error);
      return { attempted: true, success: false, error };
    }

    const result = await graphql(apiKey, `
      mutation ($id: Int!) {
        insert_follow(followable_id: $id, followable_type: "Author") { id error }
      }
    `, { id: Number(hardcoverAuthorId) });
    if (result?.insert_follow?.error) throw new Error(result.insert_follow.error);

    console.log(`[HardcoverAuthorSync] "${author.name}" suivi synchronisé (author_id ${hardcoverAuthorId})`);
    await persist(authorFollow._id, 'synced', null);
    return { attempted: true, success: true, error: null };
  } catch (err) {
    console.warn(`[HardcoverAuthorSync] Échec suivi pour "${author?.name}":`, err.message);
    await persist(authorFollow._id, 'error', err.message);
    return { attempted: true, success: false, error: err.message };
  }
}

/**
 * Retire le suivi d'un auteur côté Hardcover (delete_follow), best-effort —
 * appelé juste avant la suppression d'un AuthorFollow, n'empêche jamais le
 * désabonnement local de se terminer en cas d'échec.
 */
export async function unsyncAuthorFollowFromHardcover(userId, author) {
  try {
    const apiKey = await getApiKey(userId);
    if (!apiKey || !author?.hardcoverAuthorId) return;
    await graphql(apiKey, `
      mutation ($id: Int!) {
        delete_follow(followable_id: $id, followable_type: "Author") { success }
      }
    `, { id: Number(author.hardcoverAuthorId) });
  } catch (err) {
    console.warn(`[HardcoverAuthorSync] Échec désabonnement Hardcover pour "${author?.name}":`, err.message);
  }
}

/**
 * Filet de sécurité quotidien (appelé depuis le même cron que la bibliothèque,
 * hardcoverSyncCron.js) — rattrape les AuthorFollow jamais synchronisés ou en
 * erreur, même principe que syncUserLibrary.
 */
export async function syncUserAuthorFollows(user, { force = false } = {}) {
  const orConditions = [
    { 'hardcoverSync.syncedAt': null },
    { $expr: { $gt: ['$updatedAt', '$hardcoverSync.syncedAt'] } },
  ];
  if (force) orConditions.push({ 'hardcoverSync.status': 'error' });

  const follows = await AuthorFollow.find({ user: user._id, $or: orConditions }).populate('author');
  if (follows.length === 0) {
    console.log(`[HardcoverAuthorSync] Aucun auteur suivi à synchroniser pour ${user.username || user._id}`);
    return { count: 0 };
  }
  console.log(`[HardcoverAuthorSync] ${follows.length} auteur(s) suivi(s) à synchroniser pour ${user.username || user._id}`);

  for (const follow of follows) {
    if (!follow.author) {
      console.warn(`[HardcoverAuthorSync] AuthorFollow ${follow._id} ignoré : auteur introuvable (référence cassée)`);
      continue;
    }
    await syncAuthorFollowToHardcover(user._id, follow, follow.author);
  }
  return { count: follows.length };
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Importe les auteurs déjà suivis sur Hardcover vers EbookRequest — une seule
 * fois (pas de synchro continue dans ce sens), même principe que
 * importHardcoverLibrary. N'ajoute que les auteurs absents côté EbookRequest,
 * ne touche jamais à un suivi déjà présent.
 */
export async function importFollowedAuthorsFromHardcover(userId) {
  const { followAuthor } = await import('./authorFollowService.js');

  const apiKey = await getApiKey(userId);
  if (!apiKey) return { imported: 0, skipped: 0, error: 'Synchro Hardcover non activée' };

  const data = await graphql(apiKey, `
    {
      follows(where: { followable_type: { _eq: "Author" } }) {
        followable_id
        author { id name }
      }
    }
  `, {});
  const rows = (data?.follows || []).filter(r => r.author?.name);

  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    const name = row.author.name.trim();
    const alreadyLocal = await Author.findOne({ hardcoverAuthorId: String(row.followable_id) }).select('_id');
    if (alreadyLocal) {
      const existingFollow = await AuthorFollow.findOne({ user: userId, author: alreadyLocal._id }).select('_id');
      if (existingFollow) { skipped++; continue; }
    }

    try {
      const matches = await searchAuthors(name, 1);
      const match = matches[0];
      if (!match || match.name.trim().toLowerCase() !== name.toLowerCase()) {
        skipped++;
        continue;
      }
      const { follow } = await followAuthor(userId, match.openLibraryKey, false);
      await AuthorFollow.updateOne(
        { _id: follow._id },
        { importedFrom: 'hardcover', hardcoverSync: { status: 'synced', syncedAt: new Date(), error: '' } }
      );
      await Author.updateOne({ openLibraryKey: match.openLibraryKey }, { hardcoverAuthorId: String(row.followable_id) });
      imported++;
    } catch (err) {
      // Déjà suivi, limite atteinte, ou auteur introuvable côté Open Library — ignoré, pas bloquant pour le reste de l'import.
      skipped++;
    }
  }

  console.log(`[HardcoverAuthorImport] ${imported} auteur(s) importé(s), ${skipped} ignoré(s)`);
  return { imported, skipped, error: null };
}
