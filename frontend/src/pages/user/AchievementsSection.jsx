import React, { useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import styles from './ProfilePage.module.css';
import hardcoverLogo from '../../assets/icons/hardcover-mono.png';
import { shareAchievementImage, TIER_HEX, GENERIC_ACCENT_HEX } from '../../utils/achievementShare';

// Reconstruit l'icône React réellement utilisée dans l'app (ligne/pleine en SVG, logo
// raster, ou texte comme "404") pour l'image de partage, plutôt qu'un emoji générique —
// les SVG s'appuient sur des classes CSS (fill:none/stroke:currentColor) qui n'existent
// pas hors du DOM de l'app, donc reteintées explicitement ici.
function resolveShareIcon(icon, accentHex, filled) {
  if (!React.isValidElement(icon)) return {};
  // `icon` est souvent <Icon /> (élément dont le type est le composant, pas 'svg') —
  // on rend le composant et on inspecte sa sortie, plutôt que de se fier à icon.type
  // qui ne correspond qu'à un <svg> passé directement.
  const markup = renderToStaticMarkup(icon);
  if (markup.startsWith('<svg')) {
    const presentation = filled
      ? `fill="${accentHex}" stroke="none"`
      : `fill="none" stroke="${accentHex}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;
    return { iconSvgMarkup: markup.replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" ${presentation} `) };
  }
  if (markup.startsWith('<img')) {
    const src = markup.match(/src="([^"]+)"/)?.[1];
    return src ? { iconImageSrc: src } : {};
  }
  const text = markup.replace(/<[^>]+>/g, '').trim();
  return text ? { iconText: text } : {};
}

// Mêmes filtres duotone que .hardcoverImg.tierXxx (ProfilePage.module.css), dupliqués
// ici pour l'image de partage (canvas, pas de CSS disponible).
const HARDCOVER_TIER_FILTER = {
  bronze: 'sepia(1) saturate(4) hue-rotate(-8deg) brightness(0.95)',
  silver: 'none',
  gold: 'sepia(1) saturate(4) hue-rotate(8deg) brightness(1.05)',
  platinum: 'sepia(1) saturate(4) hue-rotate(150deg) brightness(1.05)',
  diamond: 'sepia(1) saturate(4) hue-rotate(213deg) brightness(1)',
  diamondBlue: 'sepia(1) saturate(4) hue-rotate(182deg) brightness(1)',
  diamondRed: 'sepia(1) saturate(4) hue-rotate(325deg) brightness(1)',
  diamondBlack: 'grayscale(1) brightness(0.75)',
  legend: 'sepia(1) saturate(4) hue-rotate(253deg) brightness(1)',
};

// Recolore une image/silhouette monochrome via currentColor (masque CSS) — utilisé
// uniquement pour Hardcover (raster), pas pour Apple : un masque sur fichier SVG
// externe échoue silencieusement dans certains navigateurs (fallback = carré plein),
// donc le logo Apple est inliné directement en JSX (voir AppleIcon ci-dessous).
const MaskIcon = ({ src, alt, className }) => (
  <span className={className} style={{ WebkitMaskImage: `url(${src})`, maskImage: `url(${src})` }} role="img" aria-label={alt} />
);

// Path issu du SVG fourni (assets/icons/apple.svg), inliné avec fill="currentColor"
// pour hériter la couleur du palier comme les autres icônes.
const AppleIcon = () => (
  <svg viewBox="0 0 22.773 22.773" className={styles.filledIcon}>
    <path d="M15.769,0c0.053,0,0.106,0,0.162,0c0.13,1.606-0.483,2.806-1.228,3.675c-0.731,0.863-1.732,1.7-3.351,1.573
      c-0.108-1.583,0.506-2.694,1.25-3.561C13.292,0.879,14.557,0.16,15.769,0z"/>
    <path d="M20.67,16.716c0,0.016,0,0.03,0,0.045c-0.455,1.378-1.104,2.559-1.896,3.655c-0.723,0.995-1.609,2.334-3.191,2.334
      c-1.367,0-2.275-0.879-3.676-0.903c-1.482-0.024-2.297,0.735-3.652,0.926c-0.155,0-0.31,0-0.462,0
      c-0.995-0.144-1.798-0.932-2.383-1.642c-1.725-2.098-3.058-4.808-3.306-8.276c0-0.34,0-0.679,0-1.019
      c0.105-2.482,1.311-4.5,2.914-5.478c0.846-0.52,2.009-0.963,3.304-0.765c0.555,0.086,1.122,0.276,1.619,0.464
      c0.471,0.181,1.06,0.502,1.618,0.485c0.378-0.011,0.754-0.208,1.135-0.347c1.116-0.403,2.21-0.865,3.652-0.648
      c1.733,0.262,2.963,1.032,3.723,2.22c-1.466,0.933-2.625,2.339-2.427,4.74C17.818,14.688,19.086,15.964,20.67,16.716z"/>
  </svg>
);

export const TIER_CLASS = {
  bronze: styles.tierBronze,
  silver: styles.tierSilver,
  gold: styles.tierGold,
  platinum: styles.tierPlatinum,
  diamond: styles.tierDiamond,
  diamondBlue: styles.tierDiamondBlue,
  diamondRed: styles.tierDiamondRed,
  diamondBlack: styles.tierDiamondBlack,
  legend: styles.tierLegend,
};

export const TIER_LABELS = {
  bronze: 'Bronze',
  silver: 'Argent',
  gold: 'Or',
  platinum: 'Platine',
  diamond: 'Diamant',
  diamondBlue: 'Diamant bleu',
  diamondRed: 'Diamant rouge',
  diamondBlack: 'Diamant noir',
  legend: 'Légende',
};

const LayersIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M12 2 2 7l10 5 10-5-10-5Z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>
);
const BookIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
);
const SparkleIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" /></svg>
);
const ShieldIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M12 2 4 6v6c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V6l-8-4Z" /></svg>
);
const EnvelopeIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M22 6 12 13 2 6" /><rect x="2" y="4" width="20" height="16" rx="2" /></svg>
);
const CalendarIcon = () => (
  <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
);
const FlameIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" /></svg>
);
const ShelfIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M3 21V3M21 21V3M6 3v18M10 3v18M14 21l0-18 4 2v14" /></svg>
);
const MoonIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" /></svg>
);
const ReaderIcon = () => (
  <svg viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2" /><path d="M8 7h8M8 11h8M8 15h5" /></svg>
);
const PlugIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M9 2v4M15 2v4M6 8h12l-1 6a5 5 0 0 1-10 0Z" /><path d="M10 20h4M12 16v4" /></svg>
);
const ChatIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" /></svg>
);
const FlaskIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3" /><path d="M7.5 15h9" /></svg>
);
const EggIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M12 3c-2.8 0-5 5-5 10a5 5 0 0 0 10 0c0-5-2.2-10-5-10Z" /></svg>
);
const ShareIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
);
const PulseIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
);
const Icon404 = () => (
  <span className={styles.textIcon}>404</span>
);

const ICONS = {
  requests: LayersIcon,
  reading: BookIcon,
  aiBestseller: SparkleIcon,
  twoFactor: ShieldIcon,
  emailVerified: EnvelopeIcon,
  tenure: CalendarIcon,
  chatbot: ChatIcon,
  calibreSync: ShelfIcon,
  connectors: PlugIcon,
  kindle: ReaderIcon,
  nightOwl: MoonIcon,
  streak: FlameIcon,
};

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

const ShareOutIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
  </svg>
);

function AchievementCard({ unlocked, tierClass, icon, tierLabel, name, shareLabel, shareRank, accentHex, thresholdLabel, filledIcon, imageFilter }) {
  const [sharing, setSharing] = useState(false);

  const handleShare = async (e) => {
    e.stopPropagation();
    if (sharing) return;
    setSharing(true);
    const resolvedAccent = accentHex || GENERIC_ACCENT_HEX;
    try {
      const { iconSvgMarkup, iconImageSrc, iconText } = resolveShareIcon(icon, resolvedAccent, filledIcon);
      await shareAchievementImage({
        label: shareLabel || name,
        tierLabel: shareRank || null,
        accentHex: resolvedAccent,
        thresholdLabel,
        iconSvgMarkup,
        iconImageSrc,
        iconImageFilter: iconImageSrc ? imageFilter : undefined,
        iconText,
      });
    } catch {
      // partage annulé ou non supporté, pas d'erreur à afficher
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className={`${styles.achievementCard} ${unlocked ? tierClass : ''} ${unlocked ? '' : styles.locked}`}>
      {unlocked && (
        <button type="button" className={styles.shareBtn} onClick={handleShare} disabled={sharing} title="Partager ce succès">
          <ShareOutIcon />
        </button>
      )}
      <div className={styles.achievementMedal}>
        <div className={styles.achievementIcon}>{icon}</div>
      </div>
      <div className={styles.achievementTier}>{tierLabel}</div>
      <div className={styles.statLabel}>{name}</div>
    </div>
  );
}

function ProgressiveCategory({ id, label, tiers }) {
  return (
    <div className={styles.achievementCategory}>
      <div className={styles.achievementCategoryHead}>
        <p className={styles.achievementCategoryTitle}>{label}</p>
      </div>
      <div className={styles.achievementsGrid}>
        {tiers.map(tier => {
          const Icon = ICONS[id];
          return (
            <AchievementCard
              key={tier.threshold}
              unlocked={tier.unlocked}
              tierClass={TIER_CLASS[tier.tier]}
              icon={id === 'hardcoverSync'
                ? <img src={hardcoverLogo} alt="Hardcover" className={`${styles.hardcoverImg} ${TIER_CLASS[tier.tier]}`} />
                : Icon && <Icon />}
              tierLabel={tier.unlocked ? TIER_LABELS[tier.tier] : 'Verrouillé'}
              name={tierName(id, tier.threshold)}
              shareLabel={label}
              shareRank={TIER_LABELS[tier.tier]}
              accentHex={TIER_HEX[tier.tier]}
              thresholdLabel={`Palier ${tier.threshold}`}
              imageFilter={id === 'hardcoverSync' ? HARDCOVER_TIER_FILTER[tier.tier] : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

export default function AchievementsSection({ achievements }) {
  if (!achievements) return null;
  const byId = Object.fromEntries(achievements.categories.map(c => [c.id, c]));

  const progressiveIds = ['requests', 'reading', 'aiBestseller', 'tenure', 'streak', 'chatbot', 'calibreSync', 'hardcoverSync'];

  return (
    <>
      {progressiveIds.map(id => {
        const cat = byId[id];
        if (!cat) return null;
        return <ProgressiveCategory key={id} id={id} label={cat.label} tiers={cat.tiers} />;
      })}

      <div className={styles.achievementCategory}>
        <div className={styles.achievementCategoryHead}>
          <p className={styles.achievementCategoryTitle}>Autres succès</p>
        </div>
        <div className={styles.achievementsGrid}>
          <AchievementCard unlocked={byId.twoFactor?.unlocked} tierClass={styles.tierAccent} icon={<ShieldIcon />} tierLabel={byId.twoFactor?.unlocked ? 'Débloqué' : 'Verrouillé'} name="2FA activée" />
          <AchievementCard unlocked={byId.emailVerified?.unlocked} tierClass={styles.tierAccent} icon={<EnvelopeIcon />} tierLabel={byId.emailVerified?.unlocked ? 'Débloqué' : 'Verrouillé'} name="Email vérifié" />
          <AchievementCard
            unlocked={byId.connectors?.unlocked}
            tierClass={styles.tierAccent}
            icon={(
              <div className={styles.connectorLetters}>
                <span>V</span><span>A</span><span>L</span><span>F</span>
              </div>
            )}
            tierLabel={byId.connectors?.unlocked ? 'Débloqué' : 'Verrouillé'}
            name="V + A + L + F"
          />
          <AchievementCard unlocked={byId.kindle?.unlocked} tierClass={styles.tierAccent} icon={<ReaderIcon />} tierLabel={byId.kindle?.unlocked ? 'Débloqué' : 'Verrouillé'} name="Envoi Kindle" />
          <AchievementCard unlocked={byId.nightOwl?.unlocked} tierClass={styles.tierAccent} icon={<MoonIcon />} tierLabel={byId.nightOwl?.unlocked ? 'Débloqué' : 'Verrouillé'} name="Oiseau de nuit" />
          <AchievementCard unlocked={byId.found404?.unlocked} tierClass={styles.tierAccent} icon={<Icon404 />} tierLabel={byId.found404?.unlocked ? 'Débloqué' : 'Verrouillé'} name="Ta vu elle est belle ma 404" />
          <AchievementCard unlocked={byId.readingShare?.unlocked} tierClass={styles.tierAccent} icon={<ShareIcon />} tierLabel={byId.readingShare?.unlocked ? 'Débloqué' : 'Verrouillé'} name="Bibliothèque partagée" />
          <AchievementCard unlocked={byId.activityVisited?.unlocked} tierClass={styles.tierAccent} icon={<PulseIcon />} tierLabel={byId.activityVisited?.unlocked ? 'Débloqué' : 'Verrouillé'} name="Curieux de l'activité" />
        </div>
      </div>

      <div className={styles.achievementCategory}>
        <div className={styles.achievementCategoryHead}>
          <p className={styles.achievementCategoryTitle}>App iOS</p>
        </div>
        <div className={styles.achievementsGrid}>
          <AchievementCard unlocked={byId.iosConnected?.unlocked} tierClass={styles.tierAccent} icon={<AppleIcon />} tierLabel={byId.iosConnected?.unlocked ? 'Débloqué' : 'Verrouillé'} name="Connecté via l'app iOS" filledIcon />
          <AchievementCard unlocked={byId.iosAlpha?.unlocked} tierClass={styles.tierAccent} icon={<FlaskIcon />} tierLabel={byId.iosAlpha?.unlocked ? 'Débloqué' : 'Verrouillé'} name="Participation à l'Alpha" />
          <AchievementCard unlocked={byId.easterEgg?.unlocked} tierClass={styles.tierAccent} icon={<EggIcon />} tierLabel={byId.easterEgg?.unlocked ? 'Débloqué' : 'Verrouillé'} name="Easter egg" />
        </div>
      </div>
    </>
  );
}
