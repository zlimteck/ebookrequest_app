import UpcomingRelease from '../models/UpcomingRelease.js';
import AdminLog from '../models/AdminLog.js';
import { fetchUpcomingReleases, resolveCoverUrl, getUpcomingReleasesConfig } from './upcomingReleasesService.js';
import { fetchHardcoverUpcomingReleases } from './hardcoverUpcomingService.js';

// Cron quotidien (issue #52), même convention que authorReleaseCron.js —
// les dates de parution annoncées sont à plusieurs semaines/mois, pas besoin
// d'un intervalle plus court.
const INTERVAL_HOURS = 24;
const STARTUP_DELAY_MS = 7 * 60 * 1000; // décalé pour ne pas concurrencer les autres crons au démarrage

async function runUpcomingReleasesCron() {
  try {
    // Revérifié à chaque cycle (pas seulement au démarrage) pour qu'un
    // admin désactivant la fonctionnalité arrête le rafraîchissement dans
    // la journée, sans attendre un redémarrage du conteneur.
    const config = await getUpcomingReleasesConfig();
    if (!config.enabled) {
      console.log('[UpcomingReleasesCron] Désactivé par l\'administrateur, cycle ignoré');
      return;
    }

    // BnF (pas de couverture/genre fournis par la source) et Hardcover (les
    // deux fournis directement par l'API, pas d'enrichissement nécessaire)
    // — les deux listes sont fusionnées dans le même modèle, distinguées par
    // `source`, et dédoublonnées ensemble par titre+auteur+date plus bas.
    const [bnfReleases, hardcoverReleases] = await Promise.all([
      fetchUpcomingReleases(),
      fetchHardcoverUpcomingReleases(),
    ]);
    const releases = [...bnfReleases, ...hardcoverReleases];

    let upserted = 0;
    let enriched = 0;
    let newCount = 0;
    for (const release of releases) {
      const existing = await UpcomingRelease.findOne({ source: release.source, externalId: release.externalId }).select('coverUrl');
      if (!existing) newCount++;

      // Couverture résolue une seule fois par annonce BnF (jamais pour
      // Hardcover, qui la fournit déjà), jamais retentée à chaque cycle si
      // elle a déjà échoué ou déjà une icône générique côté BnF — pas de
      // valeur ajoutée à réinterroger le même échec chaque jour.
      if (release.source === 'bnf' && !release.coverUrl && !existing) {
        release.coverUrl = await resolveCoverUrl(release.title, release.author);
        enriched++;
      } else if (release.source === 'bnf' && !release.coverUrl && existing) {
        release.coverUrl = existing.coverUrl;
      }

      await UpcomingRelease.findOneAndUpdate(
        { source: release.source, externalId: release.externalId },
        release,
        { upsert: true }
      );
      upserted++;
    }

    // Les annonces dont la date de parution est passée ne sont plus
    // pertinentes (même logique côté fetchUpcomingReleases, qui ne les
    // renvoie déjà plus — ce nettoyage couvre les entrées restées en base
    // d'un cycle précédent et sorties du flux depuis).
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const { deletedCount } = await UpcomingRelease.deleteMany({ releaseDate: { $lt: today } });

    // Un même livre peut être déclaré sous plusieurs id_declaration BnF
    // distincts (formats papier/numérique déclarés séparément), ou
    // exceptionnellement recoupé entre BnF et Hardcover — on ne garde que le
    // document le plus ancien par titre+auteur+date de parution.
    const duplicateGroups = await UpcomingRelease.aggregate([
      { $group: { _id: { title: { $toLower: '$title' }, author: { $toLower: '$author' }, releaseDate: '$releaseDate' }, ids: { $push: '$_id' }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ]);
    const duplicateIds = duplicateGroups.flatMap(g => g.ids.map(String).sort().slice(1));
    if (duplicateIds.length > 0) {
      await UpcomingRelease.deleteMany({ _id: { $in: duplicateIds } });
    }

    console.log(`[UpcomingReleasesCron] ${upserted} annonce(s) à jour (${bnfReleases.length} BnF, ${hardcoverReleases.length} Hardcover, ${newCount} nouvelle(s), ${enriched} couverture(s) résolue(s)), ${deletedCount} expirée(s) supprimée(s), ${duplicateIds.length} doublon(s) nettoyé(s)`);

    if (newCount > 0) {
      AdminLog.create({
        adminUsername: 'Système',
        action: 'cron_run',
        details: `Prochaines sorties : ${newCount} nouvelle(s) annonce(s) (${bnfReleases.length} BnF, ${hardcoverReleases.length} Hardcover au total), ${deletedCount} expirée(s) supprimée(s).`,
      }).catch(() => {});
    }
  } catch (err) {
    console.error('[UpcomingReleasesCron] Erreur:', err.message);
    AdminLog.create({
      adminUsername: 'Système',
      action: 'cron_run',
      details: `Prochaines sorties : erreur — ${err.message}`,
    }).catch(() => {});
  }
}

let cronIntervalId = null;
let startupTimeoutId = null;

export function startUpcomingReleasesCron() {
  if (cronIntervalId) clearInterval(cronIntervalId);
  if (startupTimeoutId) clearTimeout(startupTimeoutId);

  startupTimeoutId = setTimeout(() => {
    runUpcomingReleasesCron();
    cronIntervalId = setInterval(runUpcomingReleasesCron, INTERVAL_HOURS * 60 * 60 * 1000);
  }, STARTUP_DELAY_MS);
}
