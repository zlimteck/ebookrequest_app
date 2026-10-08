import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import BookRequest from '../models/BookRequest.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import DownloadLog from '../models/DownloadLog.js';
import { sendBookCompletedEmail } from './emailService.js';
import { sendPushToUser } from './webPushService.js';
import { runPostCompletionHooks } from './postCompletionHooks.js';
import { grabRelease } from './prowlarrService.js';
import { getTorrentStatus } from './downloadClients/index.js';
import { fetchCompletedFile } from './fileAccessService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KNOWN_EBOOK_EXTS = new Set(['epub', 'mobi', 'pdf', 'cbz', 'cbr', 'cb7', 'azw', 'azw3', 'fb2', 'djvu']);

/**
 * Lance le téléchargement d'un résultat Prowlarr pour une demande : grab via
 * Prowlarr (relayé vers le client torrent configuré de son côté), puis
 * enregistre le suivi sur la demande (BookRequest.prowlarrDownload) pour que
 * le cron de suivi la retrouve. La demande reste en attente tant que le
 * torrent n'est pas terminé — pas de synchrone ici (un torrent peut prendre
 * des heures), contrairement aux autres connecteurs qui servent un fichier
 * immédiatement.
 */
export async function startProwlarrDownload(requestId, release) {
  if (!release.guid || !release.indexerId) throw new Error('guid/indexerId manquant');

  const { hash } = await grabRelease({
    guid: release.guid,
    indexerId: release.indexerId,
    downloadUrl: release.downloadUrl,
  });
  if (!hash) {
    throw new Error('Impossible de suivre ce téléchargement (pas de lien magnet avec hash exploitable)');
  }

  await BookRequest.findByIdAndUpdate(requestId, {
    prowlarrDownload: {
      hash,
      title: release.title,
      indexerId: release.indexerId,
      grabbedAt: new Date().toISOString(),
      attempts: 0,
      lastError: null,
    },
  });

  return { hash };
}

async function finalizeRequest(request, fileBuffer, filename) {
  const uploadsDir = path.join(__dirname, '../../uploads/books');
  fs.mkdirSync(uploadsDir, { recursive: true });
  const destPath = path.join(uploadsDir, filename);
  fs.writeFileSync(destPath, fileBuffer);

  request.status = 'completed';
  request.filePath = `books/${filename}`;
  request.completedAt = new Date();
  request.prowlarrDownload = null;
  if (!Array.isArray(request.statusHistory)) request.statusHistory = [];
  request.statusHistory.push({
    status: 'completed',
    changedBy: 'prowlarr',
    note: 'Téléchargé automatiquement via Prowlarr',
  });
  await request.save();

  DownloadLog.create({
    bookRequestId: request._id, title: request.title, author: request.author, username: request.username,
    connector: 'prowlarr', success: true, triggeredBy: 'auto', searchMode: 'detailed',
  }).catch(() => {});

  runPostCompletionHooks(request, request.user).catch(e => console.error('[Prowlarr][Calibre]', e.message));

  const user = await User.findById(request.user);
  if (!user) return;
  try {
    if (user.emailVerified && user.email) await sendBookCompletedEmail(user, request);
  } catch (e) { console.error('[Prowlarr] Erreur email:', e.message); }
  try {
    await sendPushToUser(user._id, {
      title: 'Livre disponible !',
      body: `"${request.title}" a été téléchargé automatiquement.`,
      url: '/dashboard',
    });
  } catch (e) { console.error('[Prowlarr] Erreur push:', e.message); }
  try {
    await Notification.create({
      user: user._id,
      type: 'request_completed',
      title: request.title,
      author: request.author,
      message: `"${request.title}" a été téléchargé automatiquement via Prowlarr.`,
    });
  } catch (e) { console.error('[Prowlarr] Erreur notification:', e.message); }
}

// Choisit le fichier ebook le plus probable parmi ceux du torrent (certains
// releases groupent plusieurs tomes/formats) — le plus gros fichier à
// extension connue, heuristique déjà utilisée ailleurs dans ce projet pour
// des cas similaires (pas de métadonnée fiable pour trancher autrement).
function pickBestFile(files) {
  const candidates = (files || []).filter(f => {
    const ext = path.extname(f.name || '').toLowerCase().replace('.', '');
    return KNOWN_EBOOK_EXTS.has(ext);
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (b.size || 0) - (a.size || 0));
  return candidates[0];
}

/**
 * Appelée par le cron (toutes les ~5 min) : pour chaque demande en attente
 * avec un téléchargement Prowlarr en cours, vérifie l'état auprès du client
 * torrent et finalise si terminé. Best-effort par demande (une erreur sur
 * l'une n'arrête pas les autres) ; 10 tentatives max avant abandon (évite de
 * boucler indéfiniment sur un torrent mort/bloqué).
 */
export async function checkPendingProwlarrDownloads() {
  const pending = await BookRequest.find({
    status: 'pending',
    prowlarrDownload: { $ne: null },
  });

  const report = [];

  if (pending.length === 0) {
    console.log('[Prowlarr] Aucune demande en attente avec un téléchargement en cours.');
  }

  for (const request of pending) {
    const dl = request.prowlarrDownload;
    if (!dl?.hash) { report.push({ title: request.title, result: 'sans hash, ignorée' }); continue; }

    try {
      const status = await getTorrentStatus(dl.hash);
      if (!status) {
        // Pas encore apparu dans le client (latence normale juste après le grab).
        if ((dl.attempts || 0) >= 10) {
          console.warn(`[Prowlarr] Abandon suivi "${dl.title}" (jamais vu par le client après ${dl.attempts} vérifications)`);
          await BookRequest.findByIdAndUpdate(request._id, { prowlarrDownload: null });
          report.push({ title: dl.title, result: 'abandonné, jamais vu par le client' });
        } else {
          await BookRequest.findByIdAndUpdate(request._id, { 'prowlarrDownload.attempts': (dl.attempts || 0) + 1 });
          report.push({ title: dl.title, result: `pas encore vu par le client (tentative ${(dl.attempts || 0) + 1}/10)` });
        }
        continue;
      }

      if (!status.completed) {
        report.push({ title: dl.title, result: `en cours (${status.progress ?? '?'}%)` });
        continue;
      }

      const best = pickBestFile(status.files);
      if (!best) {
        console.warn(`[Prowlarr] "${dl.title}" terminé mais aucun fichier ebook reconnu parmi : ${(status.files || []).map(f => f.name).join(', ')}`);
        await BookRequest.findByIdAndUpdate(request._id, { prowlarrDownload: null });
        report.push({ title: dl.title, result: `terminé mais aucun fichier ebook reconnu (${(status.files || []).map(f => f.name).join(', ') || 'aucun fichier listé'})` });
        continue;
      }

      const buffer = await fetchCompletedFile(best.name);
      const ext = path.extname(best.name).toLowerCase();
      const baseName = request.title.replace(/[<>:"/\\|?*]/g, '').trim();
      const filename = `${baseName}${ext}`.replace(/[<>:"/\\|?*]/g, '').trim() || `${dl.hash}${ext}`;

      await finalizeRequest(request, buffer, filename);
      console.log(`[Prowlarr] ✓ "${request.title}" complétée via le client torrent`);
      report.push({ title: request.title, result: 'complétée' });
    } catch (err) {
      console.warn(`[Prowlarr] Suivi "${dl.title}" échoué: ${err.message}`);
      await BookRequest.findByIdAndUpdate(request._id, {
        'prowlarrDownload.attempts': (dl.attempts || 0) + 1,
        'prowlarrDownload.lastError': err.message,
      });
      report.push({ title: dl.title, result: `erreur : ${err.message}` });
    }
  }

  return report;
}
