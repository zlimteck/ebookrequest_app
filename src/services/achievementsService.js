import mongoose from 'mongoose';
import { FLAG_LABELS } from '../constants/flags.js';

// Paliers réutilisés par plusieurs catégories progressives — identifiants distincts
// même au-delà de "diamond" (jusqu'à 8 seuils sur Ancienneté), pour que chaque palier
// ait un tier unique côté API plutôt que de réutiliser "diamond" en boucle (voir
// issue #41 — coordination avec la session iOS). "legend" prévu par anticipation,
// aucune catégorie actuelle n'a assez de seuils pour l'atteindre.
const TIER_COLORS = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'diamondBlue', 'diamondRed', 'diamondBlack', 'legend'];
const tierForIndex = (i) => TIER_COLORS[Math.min(i, TIER_COLORS.length - 1)];

function buildTiers(thresholds, count) {
  return thresholds.map((threshold, i) => ({
    tier: tierForIndex(i),
    threshold,
    unlocked: count >= threshold,
  }));
}

// 9 seuils sur chaque catégorie progressive pour que toutes atteignent le palier
// "legend" (9 paliers : bronze/silver/gold/platinum/diamond/diamondBlue/diamondRed/
// diamondBlack/legend) — voir issue #41, coordination avec la session iOS.
const REQUEST_THRESHOLDS = [5, 20, 50, 100, 200, 500, 1000, 2500, 5000];
const READING_THRESHOLDS = [5, 20, 50, 100, 200, 500, 1000, 2500, 5000];
const AI_BESTSELLER_THRESHOLDS = [5, 10, 25, 50, 100, 250, 500, 1000, 2000];
const SYNC_THRESHOLDS = [10, 20, 50, 100, 200, 500, 1000, 2500, 5000];
// Ancienneté exprimée en mois (3 mois, 6 mois, 1/2/4/6/8/10/15 ans)
const TENURE_MONTHS_THRESHOLDS = [3, 6, 12, 24, 48, 72, 96, 120, 180];
const CHATBOT_THRESHOLDS = [5, 20, 50, 100, 200, 500, 1000, 2500, 5000];
// Série de jours consécutifs d'activité, en jours — voir streakService.js.
const STREAK_THRESHOLDS = [3, 7, 14, 30, 60, 90, 180, 365, 730];

// Connecteurs distincts nécessaires pour le succès "polyglotte" — LibGen est tracé
// séparément d'Anna's Archive depuis l'ajout du champ dédié (voir issue #41).
const ALL_CONNECTORS = ['valentine', 'annasarchive', 'libgen', 'fourtoutici'];

function monthsBetween(from, to) {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

// Libellé du palier pour le message de notification — voir tierName() côté
// frontend (AchievementsSection.jsx), gardé volontairement en double ici pour ne
// pas coupler le service backend au bundle React.
function tierName(categoryId, threshold) {
  switch (categoryId) {
    case 'requests': return `${threshold} requêtes`;
    case 'reading': return `${threshold} livres lus`;
    case 'aiBestseller': return `${threshold} fois`;
    case 'chatbot': return `${threshold} messages`;
    case 'calibreSync':
    case 'hardcoverSync': return `${threshold} livres`;
    case 'tenure': {
      if (threshold < 12) return `${threshold} mois`;
      const years = threshold / 12;
      return `${years} an${years > 1 ? 's' : ''}`;
    }
    case 'streak': return `${threshold} jours`;
    default: return `${threshold}`;
  }
}

/**
 * Calcule l'état de tous les succès pour un utilisateur. Purement dérivé de données
 * déjà en base (aucun modèle de tracking dédié), recalculé à la volée à chaque appel —
 * voir issue #41 pour la liste complète et les décisions de rétroactivité.
 */
export async function getUserAchievements(userId) {
  const User = mongoose.model('User');
  const BookRequest = mongoose.model('BookRequest');
  const ReadingList = mongoose.model('ReadingList');
  const DownloadLog = mongoose.model('DownloadLog');
  const EmailLog = mongoose.model('EmailLog');
  const Session = mongoose.model('Session');
  const Notification = mongoose.model('Notification');
  const { decrypt } = await import('./cryptoService.js');

  const user = await User.findById(userId).select('username createdAt twoFactor emailVerified easterEggUnlocked found404Unlocked activityVisitedUnlocked iosConnectedUnlocked iosAlphaUnlocked unlockedAchievements chatbotMessagesSent readingShare activityStreak unlockedFlags');
  if (!user) return null;

  const [
    requestCount,
    readCount,
    aiBestsellerCount,
    calibreSyncedCount,
    hardcoverSyncedCount,
    kindleCount,
    nightRequestExists,
    successfulConnectors,
    sessions,
  ] = await Promise.all([
    BookRequest.countDocuments({ user: userId }),
    ReadingList.countDocuments({ userId, status: 'read' }),
    BookRequest.countDocuments({ user: userId, origin: { $in: ['recommendation', 'bestseller'] } }),
    BookRequest.countDocuments({ user: userId, 'calibrePush.status': 'success' }),
    ReadingList.countDocuments({ userId, 'hardcoverSync.status': 'synced' }),
    EmailLog.countDocuments({ senderUserId: userId, type: 'kindle_delivery' }),
    // Heure UTC — approximation, pas de fuseau horaire par utilisateur en base.
    BookRequest.exists({
      user: userId,
      $expr: { $and: [{ $gte: [{ $hour: '$createdAt' }, 0] }, { $lt: [{ $hour: '$createdAt' }, 6] }] },
    }),
    DownloadLog.distinct('connector', { username: user.username, success: true }),
    // userAgent est chiffré : impossible de filtrer par regex côté Mongo, on
    // déchiffre chaque session pour repérer une connexion depuis l'app iOS.
    Session.find({ userId }).select('userAgent'),
  ]);

  const tenureMonths = monthsBetween(user.createdAt, new Date());
  const connectorsUnlocked = ALL_CONNECTORS.every(c => successfulConnectors.includes(c));

  // App iOS : "EbookRequest-iOS/<version>" — version 0.1.x = build Alpha/TestFlight,
  // 1.0+ = release publique (voir issue #41). Sticky via User.iosConnectedUnlocked/
  // iosAlphaUnlocked (voir commentaire sur ces champs) : les sessions expirées sont
  // purgées par MongoDB (TTL), donc on ne doit jamais redescendre à false une fois vrai.
  let iosConnected = user.iosConnectedUnlocked;
  let iosAlpha = user.iosAlphaUnlocked;
  for (const s of sessions) {
    const ua = decrypt(s.userAgent) || s.userAgent || '';
    const match = ua.match(/^EbookRequest-iOS\/([\d.]+)/);
    if (match) {
      iosConnected = true;
      if (/^0\.1\./.test(match[1])) iosAlpha = true;
    }
  }
  if (iosConnected !== user.iosConnectedUnlocked || iosAlpha !== user.iosAlphaUnlocked) {
    await User.updateOne({ _id: userId }, { iosConnectedUnlocked: iosConnected, iosAlphaUnlocked: iosAlpha });
  }

  const categories = [
      {
        id: 'requests',
        label: 'Requêtes',
        count: requestCount,
        tiers: buildTiers(REQUEST_THRESHOLDS, requestCount),
      },
      {
        id: 'reading',
        label: 'Lecture',
        count: readCount,
        tiers: buildTiers(READING_THRESHOLDS, readCount),
      },
      {
        id: 'aiBestseller',
        label: 'Recommandation IA & Best-seller',
        count: aiBestsellerCount,
        tiers: buildTiers(AI_BESTSELLER_THRESHOLDS, aiBestsellerCount),
        // Non rétroactif : ne compte que les demandes créées après l'ajout de
        // BookRequest.origin — voir issue #41.
        retroactive: false,
      },
      {
        id: 'twoFactor',
        label: '2FA activée',
        unlocked: !!user.twoFactor?.enabled,
      },
      {
        id: 'emailVerified',
        label: 'Email vérifié',
        unlocked: !!user.emailVerified,
      },
      {
        id: 'tenure',
        label: 'Ancienneté',
        count: tenureMonths,
        tiers: buildTiers(TENURE_MONTHS_THRESHOLDS, tenureMonths),
      },
      {
        id: 'streak',
        label: 'Série d\'activité',
        count: user.activityStreak?.longest || 0,
        tiers: buildTiers(STREAK_THRESHOLDS, user.activityStreak?.longest || 0),
      },
      {
        id: 'chatbot',
        label: 'Discussions avec l\'IA',
        count: user.chatbotMessagesSent || 0,
        tiers: buildTiers(CHATBOT_THRESHOLDS, user.chatbotMessagesSent || 0),
        // Non rétroactif : le quota chatbot était géré en mémoire (non persistant)
        // avant l'ajout de User.chatbotMessagesSent — voir issue #41.
        retroactive: false,
      },
      {
        id: 'calibreSync',
        label: 'Sync Calibre-Web',
        count: calibreSyncedCount,
        tiers: buildTiers(SYNC_THRESHOLDS, calibreSyncedCount),
      },
      {
        id: 'hardcoverSync',
        label: 'Sync Hardcover',
        count: hardcoverSyncedCount,
        tiers: buildTiers(SYNC_THRESHOLDS, hardcoverSyncedCount),
      },
      {
        id: 'connectors',
        label: 'Connecteurs (polyglotte)',
        unlocked: connectorsUnlocked,
        connectors: successfulConnectors.filter(c => ALL_CONNECTORS.includes(c)),
      },
      {
        id: 'kindle',
        label: 'Envoi Kindle',
        unlocked: kindleCount > 0,
        // Non rétroactif : ne compte que les envois faits après l'ajout du log
        // EmailLog.kindle_delivery — voir issue #41.
        retroactive: false,
      },
      {
        id: 'nightOwl',
        label: 'Oiseau de nuit',
        unlocked: !!nightRequestExists,
      },
      {
        id: 'iosConnected',
        label: 'Connecté via l\'app iOS',
        unlocked: iosConnected,
      },
      {
        id: 'iosAlpha',
        label: 'Participation à l\'Alpha iOS',
        unlocked: iosAlpha,
      },
      {
        id: 'easterEgg',
        label: 'Easter egg',
        unlocked: !!user.easterEggUnlocked,
      },
      {
        id: 'found404',
        label: 'Ta vu elle est belle ma 404',
        unlocked: !!user.found404Unlocked,
      },
      {
        id: 'readingShare',
        label: 'Bibliothèque partagée',
        // Sticky naturellement : le token n'est jamais effacé quand le partage est
        // désactivé (voir issue #39), donc sa seule présence suffit à savoir que
        // l'utilisateur a activé le partage au moins une fois.
        unlocked: !!user.readingShare?.token,
      },
      {
        id: 'activityVisited',
        label: 'Curieux de l\'activité',
        unlocked: !!user.activityVisitedUnlocked,
      },
    ];

  // Sticky : un succès déjà débloqué une fois ne doit jamais redevenir "verrouillé",
  // même si la donnée vivante qui le calcule change ensuite (ex. "Oiseau de nuit"
  // recalculé depuis une simple requête d'existence — si la demande de nuit est
  // supprimée après coup, le succès ne doit pas disparaître). On applique ce OR
  // avec l'historique AVANT de compter, pour que categories renvoyées au frontend
  // reflètent déjà l'état définitif — voir issue #41.
  const previouslyUnlocked = new Set(user.unlockedAchievements || []);
  for (const cat of categories) {
    if (cat.tiers) {
      for (const tier of cat.tiers) {
        if (!tier.unlocked && previouslyUnlocked.has(`${cat.id}-${tier.threshold}`)) tier.unlocked = true;
      }
    } else if (!cat.unlocked && previouslyUnlocked.has(cat.id)) {
      cat.unlocked = true;
    }
  }

  // Total débloqué / débloquable : chaque palier d'une catégorie progressive compte
  // pour un succès distinct, comme affiché dans l'UI (une carte par palier).
  // currentKeys/currentLabels servent aussi à détecter les nouveaux déblocages
  // (notification + push) par diff avec User.unlockedAchievements.
  let unlocked = 0;
  let total = 0;
  const currentKeys = [];
  const labelByKey = {};
  for (const cat of categories) {
    if (cat.tiers) {
      total += cat.tiers.length;
      for (const tier of cat.tiers) {
        if (!tier.unlocked) continue;
        unlocked += 1;
        const key = `${cat.id}-${tier.threshold}`;
        currentKeys.push(key);
        labelByKey[key] = `${cat.label} : ${tierName(cat.id, tier.threshold)}`;
      }
    } else {
      total += 1;
      if (cat.unlocked) {
        unlocked += 1;
        currentKeys.push(cat.id);
        labelByKey[cat.id] = cat.label;
      }
    }
  }

  const newKeys = currentKeys.filter(k => !previouslyUnlocked.has(k));

  await User.updateOne({ _id: userId }, {
    achievementsUnlocked: unlocked,
    unlockedAchievements: Array.from(new Set([...previouslyUnlocked, ...currentKeys])),
  });

  if (newKeys.length) {
    const { sendPushToUser } = await import('./webPushService.js');
    for (const key of newKeys) {
      const label = labelByKey[key];
      const message = `Nouveau succès débloqué : ${label}`;
      Notification.create({ user: userId, type: 'achievement_unlocked', title: 'Succès débloqué', message }).catch(() => {});
      sendPushToUser(userId, { title: 'Succès débloqué', body: label, url: '/profile?achievement=1' }).catch(() => {});
    }
  }

  // Titre cosmétique : palier le plus prestigieux débloqué, tous critères confondus
  // (ex. "legend" si au moins une catégorie progressive a atteint 9 paliers) —
  // purement dérivé, aucune donnée stockée, affiché à côté du pseudo sur le profil.
  let topTierIndex = -1;
  for (const cat of categories) {
    if (!cat.tiers) continue;
    for (const tier of cat.tiers) {
      if (!tier.unlocked) continue;
      const idx = TIER_COLORS.indexOf(tier.tier);
      if (idx > topTierIndex) topTierIndex = idx;
    }
  }
  const topTier = topTierIndex >= 0 ? TIER_COLORS[topTierIndex] : null;

  // Flags secrets (mini-CTF, voir src/routes/flags.js) : volontairement hors de
  // `categories`/`summary` (jamais de carte verrouillée, jamais compté dans le total)
  // — un flag non trouvé n'existe tout simplement pas dans la réponse, seuls ceux déjà
  // débloqués sont renvoyés.
  const flags = (user.unlockedFlags || []).map(slug => ({ slug, label: FLAG_LABELS[slug] || slug }));

  return {
    categories,
    summary: { unlocked, total },
    streak: { current: user.activityStreak?.current || 0, longest: user.activityStreak?.longest || 0 },
    topTier,
    flags,
  };
}
