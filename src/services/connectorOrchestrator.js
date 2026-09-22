import mongoose from 'mongoose';
import BookRequest from '../models/BookRequest.js';
import ConnectorSettings from '../models/ConnectorSettings.js';
import DownloadLog from '../models/DownloadLog.js';
import Notification from '../models/Notification.js';
import { downloadFromValentine } from './valentineService.js';
import { searchOnAnnasArchive, downloadFromAnnas, getAnnasArchiveConfig } from './annasArchiveService.js';
import { searchOnLibgen, getLibgenConfig } from './libgenService.js';
import { searchOnFourtoutici, downloadFromFourtoutici, getFourtouticiConfig } from './fourtouticiService.js';
import appriseService from './appriseService.js';
import { sendDownloadFailedToAdminsEmail, sendBookCompletedToAdminsEmail, sendKindleDelivery } from './emailService.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { sendPushToUser } from './webPushService.js';
import { emitToUser } from './socketService.js';
import { decrypt } from './cryptoService.js';

export async function logDownload({ bookRequest, connector, success, error = null, triggeredBy = 'auto', searchMode = 'detailed' }) {
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
      searchMode,
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
export async function notifyCompletion(bookRequest, meta = {}) {
  try {
    appriseService.notifyBookCompleted(bookRequest, meta).catch(() => {});

    // Email aux admins — complétion (même gate que les autres chemins de complétion)
    ConnectorSettings.findOne({ service: 'email' }).lean().then(async emailDoc => {
      const emailEnabled   = emailDoc?.emailEnabled !== false;
      const notifyOnComplete = emailDoc?.notifyOnComplete !== false;
      if (!emailEnabled || !notifyOnComplete) return;
      const AdminUser = mongoose.model('User');
      const admins = await AdminUser.find({ role: 'admin' }).select('email username emailVerified');
      admins.filter(a => a.emailVerified && a.email).forEach(admin =>
        sendBookCompletedToAdminsEmail(admin, bookRequest).catch(() => {}));
    }).catch(() => {});

    // Notification cloche pour chaque admin
    mongoose.model('User').find({ role: 'admin' }).select('_id').then(admins => {
      admins.forEach(admin => Notification.create({
        user: admin._id,
        type: 'request_completed_admin',
        title: bookRequest.title,
        author: bookRequest.author,
        message: `"${bookRequest.title}" a été téléchargé automatiquement.`,
      }).catch(() => {}));
    }).catch(() => {});

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

// Marque la demande comme non téléchargeable automatiquement : l'UI utilisateur affiche
// alors un bandeau « traitement manuel » plutôt que de laisser la demande en attente sans
// explication. Best-effort : ne doit jamais faire échouer le flux de téléchargement.
// Retourne true uniquement au PREMIER échec (flag absent avant l'appel) : les relances
// du cron sur une demande déjà marquée ne doivent pas renotifier les admins.
async function flagAutoDownloadFailed(bookRequest, reason) {
  if (!bookRequest?._id) return false;
  try {
    // findOneAndUpdate renvoie le document AVANT modification (comportement par défaut)
    const prev = await BookRequest.findOneAndUpdate(
      { _id: bookRequest._id, status: 'pending' },
      { $set: { autoDownloadFailed: { at: new Date(), reason: String(reason || '').slice(0, 300) } } }
    ).select('autoDownloadFailed user').lean();
    if (!prev) return false;
    const isFirstFailure = !prev.autoDownloadFailed?.at;
    // Pousse la mise à jour au dashboard de l'utilisateur (qui écoute déjà `request:updated`)
    // pour que le bandeau apparaisse sans rechargement.
    if (isFirstFailure && prev.user) {
      emitToUser(prev.user, 'request:updated', { id: bookRequest._id, status: 'pending' });
    }
    return isFirstFailure;
  } catch (e) {
    console.error('[Orchestrateur] Erreur marquage autoDownloadFailed:', e.message);
    return false;
  }
}

// Marque l'échec et ne notifie les admins qu'au premier échec de la demande.
// Les relances suivantes restent silencieuses ; la réussite éventuelle est signalée
// par la notification de complétion habituelle.
async function handleAutoDownloadFailure(bookRequest, reason, annaUrl) {
  if (!bookRequest) return;
  const isFirstFailure = await flagAutoDownloadFailed(bookRequest, reason);
  if (isFirstFailure) {
    await notifyAdminsDownloadFailed(bookRequest, annaUrl);
  } else {
    console.log(`[Orchestrateur] Échec déjà signalé pour "${bookRequest.title}" — pas de nouvelle notification`);
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
      await notifyCompletion(afterValentine, { connector: 'valentine', searchMode: 'detailed' });
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
          await notifyCompletion(afterValentine, { connector: 'valentine', searchMode: 'detailed' });
          return;
        }
      }
    }

    // Nettoyer l'auteur (supprimer les points parasites de Google Books)
    const cleanAuthor = (author || '')
      .replace(/([A-ZÀ-Ÿa-zà-ÿ])\./g, '$1')
      .replace(/\s+/g, ' ')
      .trim();

    // Chercher d'abord avec titre + auteur, puis titre seul en fallback
    const searchQueries = cleanAuthor
      ? [`${title} ${cleanAuthor}`, title]
      : [title];

    // ── 1c. Fallback Fourtoutici ──────────────────────────────────────────────
    // Site communautaire francophone : ni quota ni protection anti-bot connue,
    // donc essayé avant Anna's Archive/LibGen. Placé après Valentine (et pas
    // devant) tant que son taux de réussite en production n'est pas éprouvé —
    // Valentine reste la source la plus fiable de la chaîne.
    // Recherche + téléchargement propres à ce site (pas de md5 partagé avec
    // Anna's/LibGen). L'auteur n'est extrait de façon fiable que pour le
    // format EBOOK (BD/MANGA n'ont pas de séparateur auteur exploitable) —
    // un résultat sans auteur n'est donc retenu que si le titre correspond
    // fortement, plutôt que rejeté comme le ferait authorMatchScore seul.
    const fourtouticiCfg = await getFourtouticiConfig().catch(() => ({ enabled: false }));
    console.log(`[Orchestrateur][verbose] Config Fourtoutici :`, fourtouticiCfg);
    if (fourtouticiCfg.enabled) {
      console.log(`[Orchestrateur] Valentine n'a rien trouvé pour "${title}", essai Fourtoutici…`);
      console.log(`[Orchestrateur][verbose] Requêtes de recherche à tenter :`, searchQueries);
      let ftResults = [];
      for (const q of searchQueries) {
        try {
          const { results } = await searchOnFourtoutici(q);
          console.log(`[Orchestrateur][verbose] Fourtoutici renvoie ${results.length} résultat(s) pour "${q}"`);
          if (results.length) {
            ftResults = results;
            console.log(`[Orchestrateur] Fourtoutici : ${results.length} résultat(s) pour "${q}"`);
            break;
          }
        } catch (err) {
          console.log(`[Orchestrateur] Fourtoutici échec pour "${q}": ${err.message}`);
          console.log(`[Orchestrateur][verbose] Détail erreur :`, err.stack);
        }
      }

      if (ftResults.length) {
        const titleNormFt = normalizeForMatch(title);
        const reqVolumeFt = extractVolumeNumber(title);

        // Fourtoutici n'impose pas d'ordre strict "titre – auteur" côté uploadeurs
        // (certains inversent) : on teste les deux orientations par candidat et on
        // retient celle qui correspond le mieux à la demande, plutôt que de figer
        // l'ordre a priori (voir parseTitleAuthor dans fourtouticiService.js).
        const scoreOrientation = (candTitle, candAuthor) => ({
          candTitle,
          candAuthor,
          authorScore: authorMatchScore(author, candAuthor),
          titleMatch: normalizeForMatch(candTitle).includes(titleNormFt) ||
                      titleNormFt.includes(normalizeForMatch(candTitle)),
        });

        const mappedFt = ftResults.map(r => {
          const resVolume = extractVolumeNumber(r.title);
          const volumeOk = reqVolumeFt === null || resVolume === reqVolumeFt;

          const primary = scoreOrientation(r.title, r.author);
          const alt = r.altTitle ? scoreOrientation(r.altTitle, r.altAuthor) : null;
          const best = alt && (
            (alt.titleMatch && !primary.titleMatch) ||
            (alt.titleMatch === primary.titleMatch && alt.authorScore > primary.authorScore)
          ) ? alt : primary;

          return {
            ...r,
            title: best.candTitle,
            author: best.candAuthor,
            authorScore: best.authorScore,
            titleMatch: best.titleMatch,
            orientationSwapped: best === alt,
            volumeOk,
          };
        });

        const scoredFt = mappedFt
          .filter(r => r.volumeOk && (r.authorScore >= MIN_AUTHOR_SCORE || (r.author === null && r.titleMatch)));
        console.log(`[Orchestrateur][verbose] Détail du scoring (demande: titre="${title}", auteur="${author}") :`,
          mappedFt.map(r => ({
            title: r.title,
            author: r.author,
            orientationSwapped: r.orientationSwapped,
            authorScore: r.authorScore,
            titleMatch: r.titleMatch,
            retained: scoredFt.some(s => s.fileId === r.fileId),
          }))
        );
        scoredFt.sort((a, b) => {
          if (a.titleMatch !== b.titleMatch) return a.titleMatch ? -1 : 1;
          return b.authorScore - a.authorScore;
        });

        if (scoredFt.length) {
          const bestFt = scoredFt[0];
          console.log(`[Orchestrateur] Fourtoutici → "${bestFt.title}" / "${bestFt.author || '?'}" (score auteur: ${bestFt.authorScore.toFixed(2)})`);
          try {
            await downloadFromFourtoutici(bestFt.fileId, requestId);
            connectorsTried.push('fourtoutici');
            const afterFourtoutici = await BookRequest.findById(requestId).lean();
            if (afterFourtoutici?.status === 'completed') {
              console.log(`[Orchestrateur] ✓ Fourtoutici a complété "${title}"`);
              await logDownload({ bookRequest: bookRequest || afterFourtoutici, connector: 'fourtoutici', success: true });
              await notifyCompletion(afterFourtoutici, { connector: 'fourtoutici', searchMode: 'detailed' });
              return;
            }
          } catch (err) {
            console.log(`[Orchestrateur] Téléchargement Fourtoutici échoué pour "${title}": ${err.message}`);
            await logDownload({ bookRequest: bookRequest || { title, author }, connector: 'fourtoutici', success: false, error: err.message });
          }
        } else {
          console.log(`[Orchestrateur] Fourtoutici : aucun résultat avec auteur/titre compatible pour "${title}"`);
        }
      } else {
        console.log(`[Orchestrateur] Fourtoutici : aucun résultat pour "${title}"`);
      }
    } else {
      console.log(`[Orchestrateur] Fourtoutici désactivé, skip.`);
    }

    // ── 2. Fallback Anna's Archive ───────────────────────────────────────────
    console.log(`[Orchestrateur] Essai Anna's Archive pour "${title}"…`);

    // Un échec (FlareSolverr en erreur transitoire, timeout, etc.) sur une variante de
    // requête ne doit pas faire abandonner la recherche — on tente les autres variantes
    // avant de considérer Anna's Archive comme réellement indisponible.
    let results = [];
    let lastErr = null;
    for (const q of searchQueries) {
      try {
        const res = await searchOnAnnasArchive(q);
        lastErr = null;
        if (res.results?.length) {
          results = res.results;
          console.log(`[Orchestrateur] Anna's Archive : ${results.length} résultat(s) pour "${q}"`);
          break;
        }
      } catch (err) {
        lastErr = err;
        console.log(`[Orchestrateur] Anna's Archive échec pour "${q}": ${err.message}`);
      }
    }

    // ── 3. Repli LibGen ───────────────────────────────────────────────────────
    // Anna's Archive est régulièrement inaccessible (DDoS-Guard non contournable par
    // FlareSolverr/Byparr). LibGen n'a aucune protection anti-bot et partage les mêmes
    // md5, donc le téléchargement fonctionne ensuite à l'identique.
    // Couverture : romans/ouvrages — ne couvre PAS la BD ni les comics.
    if (!results.length) {
      const libgenCfg = await getLibgenConfig().catch(() => ({ enabled: false }));
      if (libgenCfg.enabled) {
        console.log(`[Orchestrateur] Anna's Archive sans résultat, essai LibGen…`);
        for (const q of searchQueries) {
          try {
            const res = await searchOnLibgen(q);
            // LibGen a répondu : l'erreur Anna's Archive n'est plus la cause de l'échec,
            // sinon on rapporterait un « 500 » périmé alors que la vraie raison est
            // simplement qu'aucune source n'a le livre.
            lastErr = null;
            if (res.results?.length) {
              results = res.results;
              console.log(`[Orchestrateur] LibGen : ${results.length} résultat(s) pour "${q}"`);
              break;
            }
            console.log(`[Orchestrateur] LibGen : aucun résultat pour "${q}"`);
          } catch (err) {
            lastErr = err;
            console.log(`[Orchestrateur] LibGen échec pour "${q}": ${err.message}`);
          }
        }
      }
    }

    if (!results.length) {
      const reason = lastErr ? `Sources indisponibles : ${lastErr.message}` : 'Aucun résultat trouvé';
      console.log(`[Orchestrateur] ${lastErr ? reason : `Aucun résultat (Anna's Archive / LibGen) pour "${title}"`}`);
      await logDownload({ bookRequest: bookRequest || { title, author }, connector: 'annasarchive', success: false, error: reason });
      await handleAutoDownloadFailure(bookRequest, lastErr ? 'Sources de téléchargement momentanément inaccessibles.' : 'Livre introuvable sur les sources automatiques.', notificationAnnaUrl);
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
      await handleAutoDownloadFailure(bookRequest, 'Aucune correspondance fiable trouvée sur les sources automatiques.', notificationAnnaUrl);
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
      await notifyCompletion(afterAnnas, { connector: 'annasarchive', searchMode: 'detailed' });
    } else {
      await logDownload({ bookRequest: bookRequest || { title, author }, connector: 'annasarchive', success: false, error: 'Téléchargement Anna\'s Archive échoué' });
      await handleAutoDownloadFailure(bookRequest, 'Le téléchargement automatique a échoué.', notificationAnnaUrl);
    }

  } catch (err) {
    console.error(`[Orchestrateur] Erreur non bloquante pour "${title}":`, err.message);
    await logDownload({ bookRequest: bookRequest || { title, author }, connector: 'valentine', success: false, error: err.message }).catch(() => {});
    await handleAutoDownloadFailure(bookRequest, 'Le téléchargement automatique a rencontré une erreur.', notificationAnnaUrl).catch(() => {});
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