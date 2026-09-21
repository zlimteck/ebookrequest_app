import BookRequest from '../models/BookRequest.js';
import User from '../models/User.js';
import AdminLog from '../models/AdminLog.js';
import appriseService from './appriseService.js';
import { sendBookReleasedEmail } from './emailService.js';
import { sendPushToUser } from './webPushService.js';

// Notifie l'utilisateur quand la date de sortie prévue (publishedDate) d'une
// demande en attente est atteinte — avant ça, les connecteurs de téléchargement
// automatique cherchent en boucle un fichier qui n'existe pas encore, sans que
// l'utilisateur en soit informé. Une seule notification par demande, marquée
// via releaseNotifiedAt pour ne pas repasser dessus à chaque exécution.
const INTERVAL_HOURS = 12;
const STARTUP_DELAY_MS = 5 * 60 * 1000;

// publishedDate est une chaîne à précision variable ("2025", "2025-06",
// "2025-06-15", cf. validation dans bookRequestController.js) — on retombe
// sur le 1er jour du mois/de l'année quand la précision est incomplète.
function parseReleaseDate(publishedDate) {
  const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(publishedDate || '');
  if (!match) return null;
  const [, year, month = '01', day = '01'] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return isNaN(date.getTime()) ? null : date;
}

async function runReleaseCheckCron() {
  try {
    const now = new Date();
    const candidates = await BookRequest.find({
      status: 'pending',
      publishedDate: { $nin: ['', null] },
      releaseNotifiedAt: null,
    }).select('title author publishedDate user createdAt');

    // Ne notifie que si la sortie était encore future au moment de la demande
    // et vient d'être atteinte depuis — un livre déjà sorti quand la demande a
    // été créée n'a rien à voir avec cette fonctionnalité (pas trouvé pour une
    // autre raison, pas parce que ce n'était "pas encore sorti").
    const due = candidates.filter(r => {
      const releaseDate = parseReleaseDate(r.publishedDate);
      return releaseDate && releaseDate <= now && releaseDate > r.createdAt;
    });

    if (due.length === 0) return;

    const userIds = [...new Set(due.map(r => r.user.toString()))];
    const users = await User.find({ _id: { $in: userIds } })
      .select('username email notificationPreferences');
    const usersById = new Map(users.map(u => [u._id.toString(), u]));

    for (const request of due) {
      const user = usersById.get(request.user.toString());
      if (user) {
        await Promise.allSettled([
          sendBookReleasedEmail(user, request),
          appriseService.notifyUserBookReleased(user, request),
          sendPushToUser(user._id, {
            title: '📅 Date de sortie atteinte',
            body: `« ${request.title} » est censé être sorti, la recherche du fichier continue.`,
            url: `/dashboard?request=${request._id}`,
          }),
        ]);
      }
      request.releaseNotifiedAt = new Date();
      await request.save();
    }

    console.log(`[ReleaseCheckCron] ${due.length} demande(s) notifiée(s) (date de sortie atteinte)`);
    AdminLog.create({
      adminUsername: 'Système',
      action: 'cron_run',
      details: `Date de sortie atteinte : ${due.length} demande(s) notifiée(s).`,
    }).catch(() => {});
  } catch (e) {
    console.error('[ReleaseCheckCron] Erreur:', e.message);
    AdminLog.create({
      adminUsername: 'Système',
      action: 'cron_run',
      details: `Date de sortie atteinte : échec de la vérification automatique (${e.message}).`,
    }).catch(() => {});
  }
}

let cronIntervalId = null;
let startupTimeoutId = null;

export function startReleaseCheckCron() {
  if (cronIntervalId) clearInterval(cronIntervalId);
  if (startupTimeoutId) clearTimeout(startupTimeoutId);

  startupTimeoutId = setTimeout(() => {
    runReleaseCheckCron();
    cronIntervalId = setInterval(runReleaseCheckCron, INTERVAL_HOURS * 60 * 60 * 1000);
  }, STARTUP_DELAY_MS);
}
