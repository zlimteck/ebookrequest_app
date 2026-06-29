import mongoose from 'mongoose';
import BookRequest from '../models/BookRequest.js';
import ConnectorSettings from '../models/ConnectorSettings.js';
import DownloadLog from '../models/DownloadLog.js';
import { downloadFromValentine } from './valentineService.js';
import { searchOnAnnasArchive, downloadFromAnnas, getAnnasArchiveConfig } from './annasArchiveService.js';
import appriseService from './appriseService.js';
import { sendDownloadFailedToAdminsEmail, sendKindleDelivery } from './emailService.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { sendPushToUser } from './webPushService.js';
import { decrypt } from './cryptoService.js';

async function logDownload({ bookRequest, connector, success, error = null, triggeredBy = 'auto' }) {
  try {
    await DownloadLog.create({
      bookRequestId: bookRequest._id || bookRequest,
      title:        bookRequest.title   || '',
      author:       bookRequest.author  || '',
      username:     bookRequest.username || '',
      connector,
      success,
      error: error ? String(error).slice(0, 500) : null,
      triggeredBy,
    });
  } catch (e) {
    console.error('[DownloadLog] Erreur écriture log:', e.message);
  }
}

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
    const user = await User.findById(bookRequest.user)
      .select('username notificationPreferences kindleEmail emailVerified');
    if (user) {
      appriseService.notifyUserBookCompleted(user, bookRequest).catch(() => {});

      // Livraison Kindle
      if (
        bookRequest.filePath &&
        user.emailVerified &&
        user.kindleEmail &&
        user.notificationPreferences?.kindle?.enabled
      ) {
        const uploadsRoot = path.resolve(__dirname, '../../uploads');
        const absolutePath = path.resolve(uploadsRoot, bookRequest.filePath);
        if (absolutePath.startsWith(uploadsRoot + path.sep) && fs.existsSync(absolutePath)) {
          const filename = path.basename(absolutePath);
          sendKindleDelivery(user.kindleEmail, absolutePath, filename)
            .then(() => console.log(`[Kindle] Envoyé à ${user.kindleEmail} : ${filename}`))
            .catch(e => console.error('[Kindle] Erreur envoi:', e.message));
        } else {
          console.error('[Kindle] Fichier introuvable ou chemin invalide:', bookRequest.filePath);
        }
      }
    }
  } catch (e) {
    console.error('[Orchestrateur] Erreur notification:', e.message);
  }
}

/**
 * Notifie les admins qu'un téléchargement automatique a échoué (web push + email + Apprise).
 */
async function notifyAdminsDownloadFailed(bookRequest, annaUrl) {
  try {
    const emailDoc = await ConnectorSettings.findOne({ service: 'email' }).lean();
    const emailEnabled   = emailDoc?.emailEnabled !== false;
    const notifyOnFailed = emailDoc?.notifyOnDownloadFailed !== false;

    const User   = mongoose.model('User');
    const admins = await User.find({ role: 'admin' }).select('email username emailVerified _id');
    const tasks  = [];

    const adminsWithEmail = admins.filter(a => a.emailVerified && a.email);

    if (emailEnabled && notifyOnFailed) {
      for (const admin of admins) {
        tasks.push(sendPushToUser(admin._id, {
          title: '⚠️ Téléchargement échoué',
          body:  `"${bookRequest.title}" nécessite un téléchargement manuel.`,
          url:   '/admin',
        }));
      }
      for (const admin of adminsWithEmail) {
        tasks.push(sendDownloadFailedToAdminsEmail(admin, bookRequest, annaUrl));
      }
    }

    tasks.push(appriseService.notifyDownloadFailed(bookRequest, annaUrl).catch(() => {}));
    await Promise.allSettled(tasks);
    console.log(`[Orchestrateur] Admins notifiés — téléchargement manuel requis pour "${bookRequest.title}"`);
  } catch (e) {
    console.error('[Orchestrateur] Erreur notification admin:', e.message);
  }
}

/**
 * Téléchargement automatique avec fallback :
 *   1. Valentine (si activé)
 *   2. Anna's Archive (si activé et Valentine n'a rien trouvé)
 *
 * Non bloquant — toutes les erreurs sont capturées.
 */
function isPublishedInFuture(dateStr) {
  if (!dateStr) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const parts = dateStr.split('-');
  let d;
  if (parts.length === 1) d = new Date(parseInt(parts[0]), 0, 1);
  else if (parts.length === 2) d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1);
  else d = new Date(dateStr);
  return !isNaN(d.getTime()) && d > today;
}

export async function downloadWithFallback(title, author, requestId, category = 'ebook', userId = null) {
  const connectorsTried = [];
  const bookRequest = await BookRequest.findById(requestId).lean();

  if (isPublishedInFuture(bookRequest?.publishedDate)) {
    console.log(`[Orchestrateur] "${title}" ignoré — date de sortie future : ${bookRequest.publishedDate}`);
    return;
  }

  // URL de fallback pour la notification — on utilise le domaine configuré (pas .org, bloqué dans certains pays)
  const annaConfig = await getAnnasArchiveConfig().catch(() => null);
  const annaBaseUrl = (annaConfig?.url || 'https://annas-archive.pk').replace(/\/$/, '');
  let notificationAnnaUrl = `${annaBaseUrl}/search?q=${encodeURIComponent(title)}`;
  try {
    // ── Récupérer les credentials Valentine personnels du user (si disponibles) ─
    let userValentineCredentials = null;
    if (userId) {
      try {
        const User = mongoose.model('User');
        const user = await User.findById(userId).select('valentine');
        const raw = user?.valentine?.password || '';
        const pw = decrypt(raw) ?? raw;
        if (user?.valentine?.username && pw) {
          userValentineCredentials = { username: user.valentine.username, password: pw };
          console.log(`[Orchestrateur] Utilisation du compte Valentine personnel de l'user ${userId}`);
        }
      } catch (e) {
        console.error('[Orchestrateur] Erreur récupération credentials Valentine user:', e.message);
      }
    }

    // ── 1. Tentative Valentine ───────────────────────────────────────────────
    await downloadFromValentine(title, author, requestId, category, userValentineCredentials);
    connectorsTried.push('valentine');

    // Vérifier si Valentine a complété la demande
    let afterValentine = await BookRequest.findById(requestId).lean();
    if (afterValentine?.status === 'completed') {
      console.log(`[Orchestrateur] ✓ Valentine a complété "${title}"`);
      await logDownload({ bookRequest: bookRequest || afterValentine, connector: 'valentine', success: true });
      await notifyCompletion(afterValentine);
      return;
    }

    // ── 1b. Fallback vers le compte Valentine admin (si user avait ses propres creds) ─
    if (userValentineCredentials) {
      const valentineDoc = await ConnectorSettings.findOne({ service: 'valentine' }).lean();
      if (valentineDoc?.valentineFallbackToAdmin && valentineDoc?.enabled && valentineDoc?.username && valentineDoc?.password) {
        console.log(`[Orchestrateur] Quota Valentine user épuisé — fallback vers le compte admin pour "${title}"`);
        await downloadFromValentine(title, author, requestId, category, null);
        connectorsTried.push('valentine-admin-fallback');
        afterValentine = await BookRequest.findById(requestId).lean();
        if (afterValentine?.status === 'completed') {
          console.log(`[Orchestrateur] ✓ Valentine (admin fallback) a complété "${title}"`);
          await logDownload({ bookRequest: bookRequest || afterValentine, connector: 'valentine', success: true });
          await notifyCompletion(afterValentine);
          return;
        }
      }
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
        if (bookRequest) await notifyAdminsDownloadFailed(bookRequest, notificationAnnaUrl);
        return;
      }
    }

    if (!results.length) {
      console.log(`[Orchestrateur] Aucun résultat Anna's Archive pour "${title}"`);
      await logDownload({ bookRequest: bookRequest || { title, author }, connector: 'annasarchive', success: false, error: 'Aucun résultat trouvé' });
      if (bookRequest) await notifyAdminsDownloadFailed(bookRequest, notificationAnnaUrl);
      return;
    }

    // ── Sélectionner le meilleur résultat avec vérification auteur + tome ────
    const titleNorm = normalizeForMatch(title);
    const reqVolume = extractVolumeNumber(title);

    const scored = results
      .map(r => {
        const resVolume = extractVolumeNumber(r.title);
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
      await logDownload({ bookRequest: bookRequest || { title, author }, connector: 'annasarchive', success: false, error: 'Aucun résultat avec auteur compatible' });
      if (bookRequest) await notifyAdminsDownloadFailed(bookRequest, notificationAnnaUrl);
      return;
    }

    const best = scored[0];
    // Mettre à jour l'URL de notification avec la fiche md5 précise (accessible aussi depuis le catch)
    if (best.md5) notificationAnnaUrl = `${annaBaseUrl}/md5/${best.md5}`;
    console.log(`[Orchestrateur] Anna's Archive → "${best.title}" / "${best.author}" (score auteur: ${best.authorScore.toFixed(2)})`);

    await downloadFromAnnas(best.md5, requestId, best.format);
    connectorsTried.push('annas-archive');

    const afterAnnas = await BookRequest.findById(requestId).lean();
    if (afterAnnas?.status === 'completed') {
      console.log(`[Orchestrateur] ✓ Anna's Archive a complété "${title}"`);
      await logDownload({ bookRequest: bookRequest || afterAnnas, connector: 'annasarchive', success: true });
      await notifyCompletion(afterAnnas);
    } else {
      await logDownload({ bookRequest: bookRequest || { title, author }, connector: 'annasarchive', success: false, error: 'Téléchargement Anna\'s Archive échoué' });
      if (bookRequest) await notifyAdminsDownloadFailed(bookRequest, notificationAnnaUrl);
    }

  } catch (err) {
    console.error(`[Orchestrateur] Erreur non bloquante pour "${title}":`, err.message);
    await logDownload({ bookRequest: bookRequest || { title, author }, connector: 'valentine', success: false, error: err.message }).catch(() => {});
    // notificationAnnaUrl est défini avant le try, donc accessible ici (et mis à jour si un md5 a été trouvé)
    if (bookRequest) await notifyAdminsDownloadFailed(bookRequest, notificationAnnaUrl).catch(() => {});
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