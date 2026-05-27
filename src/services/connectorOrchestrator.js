import mongoose from 'mongoose';
import BookRequest from '../models/BookRequest.js';
import { downloadFromValentine } from './valentineService.js';
import { searchOnAnnasArchive, downloadFromAnnas } from './annasArchiveService.js';
import appriseService from './appriseService.js';

// ─── Helpers de matching (dupliqués ici pour éviter une dépendance circulaire) ─

function normalizeForMatch(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,'"""'']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Score 0–1 : proportion des tokens de requestAuthor présents dans resultAuthor.
 * Retourne 1 si aucun auteur n'est fourni (pas de contrainte).
 */
function authorMatchScore(requestAuthor, resultAuthor) {
  if (!requestAuthor) return 1;
  const reqTokens = normalizeForMatch(requestAuthor).split(' ').filter(t => t.length > 1);
  if (!reqTokens.length) return 1;
  if (!resultAuthor) return 0;
  const resTokens = normalizeForMatch(resultAuthor).split(' ').filter(t => t.length > 1);
  let matches = 0;
  for (const rw of reqTokens) {
    if (resTokens.some(w => w === rw || w.startsWith(rw) || rw.startsWith(w))) matches++;
  }
  return matches / reqTokens.length;
}

const MIN_AUTHOR_SCORE = 0.5;

/**
 * Extrait le numéro de volume/tome d'un titre (T01, T15, Vol. 3, Vol.3, #3…).
 * Retourne null si aucun numéro trouvé.
 */
function extractVolumeNumber(title) {
  const m = normalizeForMatch(title).match(
    /(?:^|\s)(?:t|tome|vol\.?|volume|#)\s*(\d{1,3})(?:\s|$)/i
  );
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Envoie les notifications Apprise (admin global + user personnel) après une complétion automatique.
 */
async function notifyCompletion(bookRequest) {
  try {
    appriseService.notifyBookCompleted(bookRequest).catch(() => {});
    const User = mongoose.model('User');
    const user = await User.findById(bookRequest.user).select('username notificationPreferences');
    if (user) appriseService.notifyUserBookCompleted(user, bookRequest).catch(() => {});
  } catch (e) {
    console.error('[Orchestrateur] Erreur notification Apprise:', e.message);
  }
}

/**
 * Téléchargement automatique avec fallback :
 *   1. Valentine (si activé)
 *   2. Anna's Archive (si activé et Valentine n'a rien trouvé)
 *
 * Non bloquant — toutes les erreurs sont capturées.
 */
export async function downloadWithFallback(title, author, requestId, category = 'ebook') {
  const connectorsTried = [];
  try {
    // ── 1. Tentative Valentine ───────────────────────────────────────────────
    await downloadFromValentine(title, author, requestId, category);
    connectorsTried.push('valentine');

    // Vérifier si Valentine a complété la demande
    const afterValentine = await BookRequest.findById(requestId).lean();
    if (afterValentine?.status === 'completed') {
      console.log(`[Orchestrateur] ✓ Valentine a complété "${title}"`);
      await notifyCompletion(afterValentine);
      return;
    }

    // ── 2. Fallback Anna's Archive ───────────────────────────────────────────
    console.log(`[Orchestrateur] Valentine n'a rien trouvé pour "${title}", essai Anna's Archive…`);

    // Nettoyer l'auteur (supprimer les points parasites de Google Books)
    const cleanAuthor = (author || '')
      .replace(/([A-ZÀ-Ÿa-zà-ÿ])\./g, '$1')
      .replace(/\s+/g, ' ')
      .trim();

    // Chercher d'abord avec titre + auteur, puis titre seul en fallback
    const searchQueries = cleanAuthor
      ? [`${title} ${cleanAuthor}`, title]
      : [title];

    let results = [];
    for (const q of searchQueries) {
      try {
        const res = await searchOnAnnasArchive(q);
        if (res.results?.length) {
          results = res.results;
          console.log(`[Orchestrateur] Anna's Archive : ${results.length} résultat(s) pour "${q}"`);
          break;
        }
      } catch (err) {
        console.log(`[Orchestrateur] Anna's Archive indisponible: ${err.message}`);
        return;
      }
    }

    if (!results.length) {
      console.log(`[Orchestrateur] Aucun résultat Anna's Archive pour "${title}"`);
      return;
    }

    // ── Sélectionner le meilleur résultat avec vérification auteur + tome ────
    const titleNorm = normalizeForMatch(title);
    const reqVolume = extractVolumeNumber(title);

    const scored = results
      .map(r => {
        const resVolume = extractVolumeNumber(r.title);
        // Si la demande a un numéro de tome, le résultat doit avoir le même
        const volumeOk = reqVolume === null || resVolume === reqVolume;
        return {
          ...r,
          authorScore: authorMatchScore(author, r.author),
          titleMatch: normalizeForMatch(r.title).includes(titleNorm) ||
                      titleNorm.includes(normalizeForMatch(r.title)),
          volumeOk,
        };
      })
      .filter(r => r.authorScore >= MIN_AUTHOR_SCORE && r.volumeOk)
      .sort((a, b) => {
        if (a.titleMatch !== b.titleMatch) return a.titleMatch ? -1 : 1;
        return b.authorScore - a.authorScore;
      });

    if (!scored.length) {
      console.log(`[Orchestrateur] Anna's Archive : aucun résultat avec auteur compatible pour "${title}" / "${author}"`);
      return;
    }

    const best = scored[0];
    console.log(`[Orchestrateur] Anna's Archive → "${best.title}" / "${best.author}" (score auteur: ${best.authorScore.toFixed(2)})`);

    await downloadFromAnnas(best.md5, requestId, best.format);
    connectorsTried.push('annas-archive');

    // Vérifier si Anna's Archive a complété la demande
    const afterAnnas = await BookRequest.findById(requestId).lean();
    if (afterAnnas?.status === 'completed') {
      console.log(`[Orchestrateur] ✓ Anna's Archive a complété "${title}"`);
      await notifyCompletion(afterAnnas);
    }

  } catch (err) {
    console.error(`[Orchestrateur] Erreur non bloquante pour "${title}":`, err.message);
  } finally {
    if (connectorsTried.length) {
      try {
        await BookRequest.findByIdAndUpdate(requestId, {
          lastAutoAttempt: { date: new Date(), connectors: connectorsTried }
        });
      } catch {}
    }
  }
}