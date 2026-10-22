import Author from '../models/Author.js';
import AuthorFollow from '../models/AuthorFollow.js';
import User from '../models/User.js';
import AdminLog from '../models/AdminLog.js';
import Notification from '../models/Notification.js';
import appriseService from './appriseService.js';
import { sendNewAuthorReleaseEmail } from './emailService.js';
import { sendPushToUser } from './webPushService.js';
import { downloadWithFallback } from './connectorOrchestrator.js';
import { getAuthorFollowConfig, createAutoRequestIfEligible } from './authorFollowService.js';
import { getAuthorWorks, isLatinScript } from './openLibraryAuthorService.js';
import { findBestBookMatch } from './bookSearchService.js';

// Vérification une fois par jour, fixe — les sorties de livres ne sont jamais
// urgentes à la minute, pas besoin d'un intervalle configurable (décidé
// explicitement avec l'utilisateur, issue #48).
const INTERVAL_HOURS = 24;
const STARTUP_DELAY_MS = 5 * 60 * 1000;

// Un livre dont la "première publication" déclarée est trop ancienne par
// rapport au moment où il apparaît dans la bibliographie n'est pas une
// nouvelle sortie, juste une entrée indexée tardivement par Open Library
// (livre ancien republié, édition alternative ajoutée après coup...).
const MAX_RELEASE_AGE_DAYS = 14;

function isRecentRelease(firstPublishDate) {
  if (!firstPublishDate) return false;
  const date = new Date(firstPublishDate);
  if (isNaN(date.getTime())) return false;
  const ageMs = Date.now() - date.getTime();
  return ageMs >= -MAX_RELEASE_AGE_DAYS * 24 * 60 * 60 * 1000 && ageMs <= MAX_RELEASE_AGE_DAYS * 24 * 60 * 60 * 1000;
}

async function runAuthorReleaseCron() {
  try {
    const config = await getAuthorFollowConfig();
    if (!config.enabled) return;

    // Un seul check par auteur réel, jamais par abonnement — si 50 personnes
    // suivent le même auteur, un seul appel Open Library lui est consacré ce
    // cycle, pas 50.
    const followedAuthorIds = await AuthorFollow.distinct('author');
    if (followedAuthorIds.length === 0) return;
    const authors = await Author.find({ _id: { $in: followedAuthorIds } });

    let newReleasesCount = 0;
    let autoRequestsCount = 0;

    for (const author of authors) {
      let works;
      try {
        works = await getAuthorWorks(author.openLibraryKey);
      } catch (err) {
        console.warn(`[AuthorReleaseCron] Échec récupération "${author.name}":`, err.message);
        continue;
      }

      const knownSet = new Set(author.knownBookKeys);
      const newWorks = works.filter(w => !knownSet.has(w.workKey) && isRecentRelease(w.firstPublishDate));
      if (newWorks.length === 0) {
        author.knownBookKeys = works.map(w => w.workKey);
        author.lastCheckedAt = new Date();
        await author.save();
        continue;
      }

      // Le titre d'une œuvre vient de l'édition qu'Open Library a indexée en
      // premier, parfois dans la langue d'origine (manga/manhwa notamment).
      // Volume toujours faible ici (seulement les nouveautés détectées, pas
      // toute la bibliographie) : on peut se permettre de repasser par le
      // même repli multi-fournisseurs (Google Books → Hardcover → Open
      // Library) déjà utilisé pour la recherche par auteur dans les
      // demandes, plutôt que de l'appliquer à chaque livre de chaque auteur.
      for (const work of newWorks) {
        if (isLatinScript(work.title)) continue;
        try {
          const match = await findBestBookMatch({ title: work.title, author: author.name });
          if (match?.title && isLatinScript(match.title)) {
            work.title = match.title;
            if (match.thumbnail) work.coverUrl = match.thumbnail;
          }
        } catch (err) {
          console.warn(`[AuthorReleaseCron] Échec enrichissement titre "${work.title}":`, err.message);
        }
      }

      const follows = await AuthorFollow.find({ author: author._id });
      const users = await User.find({ _id: { $in: follows.map(f => f.user) } })
        .select('username email role notificationPreferences requestLimit requestLimitDays');
      const usersById = new Map(users.map(u => [u._id.toString(), u]));

      for (const work of newWorks) {
        newReleasesCount++;
        for (const follow of follows) {
          const user = usersById.get(follow.user.toString());
          if (!user) continue;

          let request = null;
          if (follow.autoRequest) {
            try {
              request = await createAutoRequestIfEligible(user, {
                title: work.title,
                author: author.name,
                publishedDate: work.firstPublishDate,
                coverUrl: work.coverUrl,
              });
              if (request) {
                autoRequestsCount++;
                downloadWithFallback(request.title, request.author, request._id.toString(), 'ebook', user._id.toString());
              }
            } catch (err) {
              console.error(`[AuthorReleaseCron] Échec demande auto "${work.title}" pour ${user.username}:`, err.message);
            }
          }

          await Promise.allSettled([
            sendNewAuthorReleaseEmail(user, {
              title: work.title,
              author: author.name,
              requestId: request?._id,
              autoRequested: !!request,
            }),
            appriseService.notifyUserNewAuthorRelease(user, {
              title: work.title,
              author: author.name,
              autoRequested: !!request,
            }),
            sendPushToUser(user._id, {
              title: 'Nouvelle sortie d\'un auteur suivi',
              body: `"${work.title}" de ${author.name} est disponible${request ? ', demande effectuée automatiquement' : ''}.`,
              url: request ? `/dashboard?request=${request._id}` : '/authors',
            }),
            // Gardé en base (contrairement à l'email/push, jamais consultables
            // après coup) pour alimenter le fil "Dernières sorties détectées"
            // affiché directement sur la page Auteurs suivis.
            Notification.create({
              user: user._id,
              type: 'new_author_release',
              title: work.title,
              author: author.name,
              message: request ? 'Demande effectuée automatiquement.' : 'Nouvelle sortie disponible.',
            }),
          ]);
        }
      }

      author.knownBookKeys = works.map(w => w.workKey);
      author.lastCheckedAt = new Date();
      await author.save();
    }

    if (newReleasesCount > 0) {
      console.log(`[AuthorReleaseCron] ${newReleasesCount} nouvelle(s) sortie(s) détectée(s), ${autoRequestsCount} demande(s) automatique(s) créée(s).`);
      AdminLog.create({
        adminUsername: 'Système',
        action: 'cron_run',
        details: `Suivi d'auteurs : ${newReleasesCount} nouvelle(s) sortie(s) détectée(s), ${autoRequestsCount} demande(s) automatique(s) créée(s).`,
      }).catch(() => {});
    }
  } catch (e) {
    console.error('[AuthorReleaseCron] Erreur:', e.message);
    AdminLog.create({
      adminUsername: 'Système',
      action: 'cron_run',
      details: `Suivi d'auteurs : échec de la vérification automatique (${e.message}).`,
    }).catch(() => {});
  }
}

let cronIntervalId = null;
let startupTimeoutId = null;

export function startAuthorReleaseCron() {
  if (cronIntervalId) clearInterval(cronIntervalId);
  if (startupTimeoutId) clearTimeout(startupTimeoutId);

  startupTimeoutId = setTimeout(() => {
    runAuthorReleaseCron();
    cronIntervalId = setInterval(runAuthorReleaseCron, INTERVAL_HOURS * 60 * 60 * 1000);
  }, STARTUP_DELAY_MS);
}
