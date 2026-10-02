import axios from 'axios';
import User from '../models/User.js';
import ReadingList from '../models/ReadingList.js';
import { decrypt } from './cryptoService.js';
import { titleMatchScore, authorMatchScore } from '../utils/textMatch.js';

// Synchronise le statut de lecture / la note d'un livre vers la bibliothèque
// personnelle Hardcover de l'utilisateur (clé API perso, distincte de celle
// des Réglages admin qui sert à la recherche/métadonnées pour tout le monde).
//
// Types de mutation custom Hardcover (pas le nommage Hasura par défaut) :
// UserBookUpdateInput pour update_user_book — confirmé via l'erreur GraphQL réelle.
// UserBookCreateInput pour insert_user_book — même logique de nommage, pas encore
// testé en conditions réelles (le chemin insert n'a pas encore été déclenché).

// 1 = à lire, 2 = en cours, 3 = lu (cf. docs.hardcover.app)
function resolveStatusId(entry) {
  if (entry.status === 'read') return 3;
  if (entry.readingProgress > 0) return 2; // en cours — déduit de la progression EPUB
  return 1;
}

// Chaque synchro d'un livre déclenche plusieurs appels GraphQL (recherche, résolution
// slug, me, vérification d'existant, mutation) — sans espacement, une rafale de livres
// dépasse vite les 60 req/min de Hardcover (constaté : "introuvable" alors qu'il existe,
// en fait une réponse d'erreur de rate-limit mal interprétée comme "aucun résultat").
// On force donc un délai minimal entre CHAQUE appel, pas seulement entre les livres.
const MIN_DELAY_BETWEEN_CALLS_MS = 1100; // ~54 req/min max, marge sous la limite de 60
let lastCallAt = 0;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function graphql(apiKey, query, variables) {
  const wait = lastCallAt + MIN_DELAY_BETWEEN_CALLS_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();

  const res = await axios.post('https://api.hardcover.app/v1/graphql', { query, variables }, {
    timeout: 12000,
    headers: {
      'Content-Type': 'application/json',
      Authorization: apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`,
    },
    validateStatus: () => true,
  });
  if (res.status === 429) throw new Error('Rate limit Hardcover atteint (429) — réessayer plus tard');
  if (res.data?.errors) throw new Error(res.data.errors[0]?.message || 'Erreur Hardcover');
  return res.data?.data;
}

// Résout le vrai book_id (table `books`) à partir du titre. Deux étapes :
// 1. Recherche floue via l'endpoint `search` (Typesense — tolère accents/variantes de titre)
//    pour récupérer le `slug` du meilleur résultat.
// 2. Résolution exacte de l'id réel via `books(where: { slug: { _eq: ... } })`.
// On n'utilise PAS directement l'`id` renvoyé par `search` : il ne correspond pas à
// l'id réel en base, ce qui fait échouer les mutations user_book avec "Record not found"
// — vérifié en conditions réelles. Le `slug`, lui, est un identifiant stable partagé
// entre l'index de recherche et la table `books`.
// (patch) : ne prenait que le tout premier résultat de recherche (per_page: 1),
// sans jamais vérifier l'auteur — un titre identique ou très proche porté par un
// autre livre (ex. un roman et son adaptation BD, par des auteurs différents)
// pouvait donc matcher le mauvais livre silencieusement. On récupère maintenant
// plusieurs candidats et on les classe par titre+auteur (mêmes scores que pour
// le matching Google Books, voir textMatch.js), pour ne retenir que le meilleur.
async function findHardcoverBookId(apiKey, { title, author }) {
  const searchData = await graphql(apiKey, `
    query Search($q: String!) {
      search(query: $q, query_type: "Book", per_page: 5, page: 1) { results }
    }
  `, { q: title.trim() });
  const hits = searchData?.search?.results?.hits || [];
  if (!hits.length) return null;

  const scored = hits
    .map(h => h?.document)
    .filter(Boolean)
    .map(doc => ({
      doc,
      score: titleMatchScore([title], doc.title || '') * 2 + authorMatchScore(author, (doc.author_names || []).join(' ')),
    }))
    .sort((a, b) => b.score - a.score);

  const slug = scored[0]?.doc?.slug;
  if (!slug) return null;

  const data = await graphql(apiKey, `
    query FindBookBySlug($slug: String!) {
      books(where: { slug: { _eq: $slug } }, limit: 1) { id }
    }
  `, { slug });
  const book = data?.books?.[0];
  return book ? book.id : null;
}

async function upsertUserBook(apiKey, bookId, statusId, rating) {
  const me = await graphql(apiKey, `{ me { id } }`);
  const userId = me?.me?.[0]?.id ?? me?.me?.id;

  // Filtré aussi par user_id : sans ça, si l'API renvoie un user_book qui n'appartient
  // pas à l'appelant, la mutation update (scopée au propriétaire côté Hardcover) échoue
  // avec "Record not found" — vérifié en conditions réelles.
  // `edition`/`user_book_reads` récupérés ici pour la progression (voir syncReadingProgress) :
  // un seul aller-retour au lieu d'une requête séparée après coup.
  const existing = await graphql(apiKey, `
    query Existing($bookId: Int!, $userId: Int) {
      user_books(where: { book_id: { _eq: $bookId }, user_id: { _eq: $userId } }, limit: 1) {
        id
        edition { id pages }
        user_book_reads(where: { finished_at: { _is_null: true } }, order_by: { started_at: desc }, limit: 1) {
          id
          started_at
        }
      }
    }
  `, { bookId, userId });
  const existingBook = existing?.user_books?.[0];
  const existingId = existingBook?.id;

  const object = { status_id: statusId, ...(rating > 0 && { rating }) };

  // UserBookIdType porte un champ `error` interne : une requête peut être un succès
  // GraphQL/HTTP tout en échouant côté Hardcover (ex. book_id invalide) — à vérifier
  // en plus de `res.data.errors`.
  const result = existingId
    ? await graphql(apiKey, `
        mutation Update($id: Int!, $object: UserBookUpdateInput!) {
          update_user_book(id: $id, object: $object) { id error }
        }
      `, { id: existingId, object })
    : await graphql(apiKey, `
        mutation Insert($object: UserBookCreateInput!) {
          insert_user_book(object: $object) { id error }
        }
      `, { object: { book_id: bookId, ...object } });

  const payload = result?.update_user_book || result?.insert_user_book;
  if (payload?.error) throw new Error(`${payload.error} (bookId=${bookId}, existingId=${existingId ?? 'aucun'})`);
  if (!payload?.id) throw new Error(`Réponse Hardcover inattendue, aucun id retourné (bookId=${bookId}, existingId=${existingId ?? 'aucun'})`);

  return {
    userBookId: payload.id,
    edition: existingBook?.edition || null,
    activeRead: existingBook?.user_book_reads?.[0] || null,
  };
}

// Pousse la progression de lecture (en pages, Hardcover n'a pas de champ pourcentage
// direct : `progress` est calculé par eux à partir de `progress_pages`/`edition.pages`).
// Repris du mécanisme de Calibre-Web-NextGen (mutations insert_user_book_read /
// update_user_book_read, non documentées sur docs.hardcover.app mais confirmées dans
// leur code source). Sans édition choisie côté Hardcover, le nombre de pages total est
// inconnu : on ne peut alors pousser qu'un statut (déjà fait par upsertUserBook), pas
// de progression chiffrée — ignoré silencieusement plutôt qu'une erreur bloquante.
async function syncReadingProgress(apiKey, { userBookId, edition, activeRead }, progressPercent, isFinished) {
  const pages = edition?.pages;
  if (!pages) return;

  const progressPages = Math.round(pages * (Math.min(100, Math.max(0, progressPercent)) / 100));
  const today = new Date().toISOString().slice(0, 10);

  if (activeRead?.id) {
    await graphql(apiKey, `
      mutation ($readId: Int!, $pages: Int, $editionId: Int, $startedAt: date, $finishedAt: date) {
        update_user_book_read(id: $readId, object: {
          progress_pages: $pages,
          edition_id: $editionId,
          started_at: $startedAt,
          finished_at: $finishedAt
        }) { id }
      }
    `, {
      readId: activeRead.id,
      pages: progressPages,
      editionId: edition.id,
      startedAt: activeRead.started_at || today,
      finishedAt: isFinished ? today : null,
    });
  } else {
    await graphql(apiKey, `
      mutation ($id: Int!, $pages: Int, $editionId: Int, $startedAt: date) {
        insert_user_book_read(user_book_id: $id, user_book_read: {
          progress_pages: $pages,
          edition_id: $editionId,
          started_at: $startedAt
        }) { error user_book_read { id } }
      }
    `, { id: userBookId, pages: progressPages, editionId: edition.id, startedAt: today });
  }
}

/**
 * Pousse le statut/note d'une entrée ReadingList vers Hardcover, si l'utilisateur
 * a activé la synchro et renseigné sa clé API personnelle. Persiste le résultat sur
 * l'entrée (`hardcoverSync.status/syncedAt/error`) pour affichage (badge sur la card).
 * Retourne { attempted, success, error } — ne lève jamais, à l'appelant de décider
 * quoi faire du résultat (la synchro ne doit jamais bloquer une action utilisateur).
 */
export async function syncReadingEntryToHardcover(userId, entry) {
  const persist = async (status, error) => {
    if (!status) return; // pas de tentative → on ne touche pas le statut affiché
    await ReadingList.updateOne(
      { _id: entry._id },
      { $set: { hardcoverSync: { status, syncedAt: new Date(), error: error || '' } } }
    ).catch(() => {});
  };

  try {
    const user = await User.findById(userId).select('hardcover');
    if (!user?.hardcover?.enabled || !user?.hardcover?.apiKey) {
      console.log(`[HardcoverSync] Synchro ignorée pour "${entry.title}" : service désactivé ou clé absente pour cet utilisateur`);
      return { attempted: false, success: false, error: null };
    }
    const apiKey = decrypt(user.hardcover.apiKey) ?? user.hardcover.apiKey;
    if (!apiKey) {
      console.log(`[HardcoverSync] Synchro ignorée pour "${entry.title}" : clé illisible (déchiffrement échoué)`);
      return { attempted: false, success: false, error: null };
    }

    const bookId = await findHardcoverBookId(apiKey, { title: entry.title, author: entry.author });
    if (!bookId) {
      const error = `Livre introuvable sur Hardcover pour "${entry.title}"`;
      console.warn(`[HardcoverSync] ${error}`);
      await persist('error', error);
      return { attempted: true, success: false, error };
    }

    const statusId = resolveStatusId(entry);
    const userBook = await upsertUserBook(apiKey, bookId, statusId, entry.rating);
    // Progression en pages, best-effort : une erreur ici ne doit pas faire échouer la
    // synchro du statut/note déjà réussie juste au-dessus.
    try {
      await syncReadingProgress(apiKey, userBook, entry.readingProgress || 0, statusId === 3);
    } catch (progressErr) {
      console.warn(`[HardcoverSync] Progression non synchronisée pour "${entry.title}":`, progressErr.message);
    }
    console.log(`[HardcoverSync] "${entry.title}" synchronisé (book_id ${bookId}, status_id ${statusId})`);
    await persist('synced', null);
    return { attempted: true, success: true, error: null };
  } catch (err) {
    console.warn(`[HardcoverSync] Échec synchro pour "${entry?.title}":`, err.message);
    await persist('error', err.message);
    return { attempted: true, success: false, error: err.message };
  }
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Un livre Hardcover existe déjà côté EbookRequest ? (même logique de dédoublonnage
// que l'ajout manuel dans reading.js — titre+auteur en case-insensitive).
async function alreadyInLibrary(userId, title, author) {
  const existing = await ReadingList.findOne({
    userId,
    title:  { $regex: new RegExp(`^${escRe(title.trim())}$`, 'i') },
    author: { $regex: new RegExp(`^${escRe(author.trim())}$`, 'i') },
  }).select('_id').lean();
  return !!existing;
}

/**
 * Importe la bibliothèque Hardcover existante de l'utilisateur vers ReadingList —
 * une seule fois (pas de synchro continue dans ce sens). Règle : n'ajoute que les
 * livres absents côté EbookRequest, ne touche jamais à un livre déjà présent (pas
 * d'écrasement de statut/note/progression déjà suivis ici).
 * Retourne { imported, skipped, error }.
 */
export async function importHardcoverLibrary(userId) {
  const user = await User.findById(userId).select('hardcover');
  if (!user?.hardcover?.enabled || !user?.hardcover?.apiKey) {
    return { imported: 0, skipped: 0, error: 'Synchro Hardcover non activée' };
  }
  const apiKey = decrypt(user.hardcover.apiKey) ?? user.hardcover.apiKey;
  if (!apiKey) return { imported: 0, skipped: 0, error: 'Clé illisible' };

  const me = await graphql(apiKey, `{ me { id } }`);
  const hcUserId = me?.me?.[0]?.id ?? me?.me?.id;
  if (!hcUserId) return { imported: 0, skipped: 0, error: 'Compte Hardcover introuvable' };

  let imported = 0;
  let skipped = 0;
  const pageSize = 50;
  const maxPages = 20; // plafond de sécurité (1000 livres) — largement suffisant en pratique

  for (let page = 0; page < maxPages; page++) {
    const data = await graphql(apiKey, `
      query MyBooks($userId: Int!, $limit: Int!, $offset: Int!) {
        user_books(where: { user_id: { _eq: $userId } }, limit: $limit, offset: $offset) {
          status_id
          rating
          book { title contributions { author { name } } image { url } }
        }
      }
    `, { userId: hcUserId, limit: pageSize, offset: page * pageSize });

    const rows = data?.user_books || [];
    if (rows.length === 0) break;

    for (const row of rows) {
      const title = row.book?.title?.trim();
      const author = row.book?.contributions?.[0]?.author?.name?.trim() || 'Auteur inconnu';
      const thumbnail = row.book?.image?.url || '';
      if (!title) { skipped++; continue; }

      if (await alreadyInLibrary(userId, title, author)) {
        skipped++;
        continue;
      }

      const isRead = row.status_id === 3;
      await ReadingList.create({
        userId,
        title,
        author,
        thumbnail,
        source: 'manual',
        importedFrom: 'hardcover',
        status: isRead ? 'read' : 'unread',
        readAt: isRead ? new Date() : null,
        readingProgress: row.status_id === 2 ? 50 : 0, // "en cours" côté Hardcover, pas de % exact disponible
        rating: row.rating > 0 ? Math.round(row.rating) : 0,
        hardcoverSync: { status: 'synced', syncedAt: new Date(), error: '' }, // vient de Hardcover, déjà à jour
      });
      imported++;
    }

    if (rows.length < pageSize) break; // dernière page
  }

  console.log(`[HardcoverImport] ${imported} livre(s) importé(s), ${skipped} déjà présent(s)`);
  return { imported, skipped, error: null };
}
