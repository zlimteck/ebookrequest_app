/**
 * Nettoie un titre de série pour des recherches externes (Valentine, Google
 * Books...) : retire suffixe après un tiret/deux-points, "Tome N", "Vol. N"
 * et parenthèses. Beaucoup de sources ne stockent que le titre du volume
 * ("The Chase"), pas le libellé complet avec série + numéro qu'on affiche à
 * l'utilisateur ("Briar Université T1 : The Chase") — sans ce nettoyage, une
 * recherche par titre complet échoue à tort alors que le livre est bien
 * présent côté source, juste sous un intitulé plus court.
 *
 * Utilisé par valentineService.js (recherche/téléchargement Valentine) et
 * bookRequestController.js (recherche de métadonnées Google Books).
 */
export function cleanSeriesTitle(title) {
  return (title || '')
    .replace(/\s*[-–—:]\s+.*/u, '')
    .replace(/\s*tome\s+\d+.*/i, '')
    .replace(/\s*vol\.?\s+\d+.*/i, '')
    .replace(/\s*\(.*\)\s*/g, '')
    .trim();
}

/**
 * Cas inverse de cleanSeriesTitle : titres du type "Série TN : Sous-titre"
 * (ex. "Briar Université T1 : The Chase") où c'est le sous-titre APRÈS le
 * séparateur qui est le vrai titre indexé ailleurs (Google Books, métadonnées
 * epub embarquées...), pas le nom de série avant. À ne pas confondre avec
 * "Série - Tome N" (rien après le numéro), où c'est l'inverse — ce cas-là
 * reste couvert par cleanSeriesTitle.
 *
 * Retourne null si le titre ne présente pas cette structure (pas de
 * "T<N> :" suivi d'un sous-titre non vide).
 */
export function extractVolumeSubtitle(title) {
  const m = (title || '').match(/^.+?\s+(?:t|tome|vol\.?|volume)\s*\d+\s*[:：]\s*(.+)$/i);
  const subtitle = m?.[1]?.trim();
  return subtitle || null;
}

/**
 * Troisième cas, distinct des deux précédents : "Série N Titre" — numéro de
 * volume nu, sans séparateur ni mot-clé ("Hercule Poirot 20 Je ne suis pas
 * coupable", "Tommy et Tuppence Beresford 06 Le crime est notre affaire").
 * Aucun des deux motifs ci-dessus ne le reconnaît (pas de "tome"/"T", pas de
 * ":"), donc le titre complet part tel quel en recherche et échoue à tort
 * quand la source externe n'indexe que le sous-titre du volume.
 *
 * Volontairement en dernier recours dans getMetadataCandidates (jamais en
 * tête de liste) : un nombre au milieu d'un titre n'est pas toujours un
 * numéro de tome (ex. "20 000 lieues sous les mers") — le risque de faux
 * positif est réel, donc cette extraction n'est tentée qu'après l'échec de
 * toutes les requêtes plus fiables (titre exact, motifs structurés).
 *
 * Retourne null si le titre ne présente pas cette structure, ou si le
 * "sous-titre" extrait est trop court (1 mot) pour être une recherche fiable.
 */
export function extractBareVolumeSubtitle(title) {
  const m = (title || '').match(/^.+?\s+\d{1,3}\s+(.+)$/);
  const subtitle = m?.[1]?.trim();
  if (!subtitle || subtitle.split(/\s+/).length < 2) return null;
  return subtitle;
}

/**
 * Nettoie un titre issu d'une release scene/P2P (ex: Prowlarr), du type
 * "Ca.T02.Stephen.King.1986.FR.[EPUB]-NOTAG" : ces titres ne matchent jamais
 * rien sur Google Books tels quels. On coupe tout après le marqueur de tome
 * ("T02") — auteur, année, langue, format et groupe de release ne sont pas
 * distinguables mot à mot du titre, donc on les retire en bloc plutôt que de
 * risquer de garder du bruit dans la requête de recherche.
 *
 * Retourne null si le titre ne ressemble pas à une release scene (pas de
 * points multiples), pour laisser le titre d'origine inchangé dans ce cas.
 */
export function cleanSceneReleaseTitle(title) {
  return parseSceneReleaseTitle(title)?.title || null;
}

/**
 * Comme cleanSceneReleaseTitle, mais garde aussi ce qui suit le marqueur de
 * tome (généralement l'auteur, ex. "Stephen.King" dans
 * "Ca.T02.Stephen.King.1986.FR.[EPUB]-NOTAG") une fois les mots de bruit
 * connus (langue, format, année 4 chiffres) retirés. Utilisé pour renseigner
 * automatiquement `BookRequest.author` sur les demandes Prowlarr, qui
 * n'ont sinon que le placeholder "Auteur inconnu" (pas de champ auteur
 * structuré sur un résultat de recherche torrent).
 *
 * Retourne null si le titre ne ressemble pas à une release scene.
 */
export function parseSceneReleaseTitle(title) {
  if (!title || typeof title !== 'string') return null;
  if (!title.includes('.')) return null;

  const NOISE_WORDS = /^(FR|FRENCH|TRUEFRENCH|VOSTFR|VF|VO|MULTI|EBOOK|EPUB|CBZ|CBR|PDF|RETAIL|WEB|SCAN|\d{4})$/i;

  const cleaned = title
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/-[a-zA-Z0-9]+$/, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tomeMatch = cleaned.match(/\b(T|Tome|Vol|Volume)\.?\s?\d+\b/i);
  if (!tomeMatch) {
    // Pas de tome : motif courant "Titre.Prénom.Nom.Année.Langue...", ex.
    // "Angélique.Guillaume.Musso.2022.fr.[ePub]-NoTag" -> on prend les 2 mots
    // juste avant l'année comme auteur, le reste avant comme titre. Besoin
    // d'au moins 3 mots avant l'année pour qu'il reste quelque chose au titre.
    const yearMatch = cleaned.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
      const before = cleaned.slice(0, yearMatch.index).trim().split(/\s+/).filter(Boolean);
      if (before.length >= 3) {
        const author = before.slice(-2).join(' ');
        const mainTitle = before.slice(0, -2).join(' ');
        return { title: mainTitle || null, author: author || null };
      }
    }
    return cleaned ? { title: cleaned, author: null } : null;
  }

  const mainTitle = cleaned.slice(0, tomeMatch.index + tomeMatch[0].length).trim();
  const author = cleaned
    .slice(tomeMatch.index + tomeMatch[0].length)
    .split(' ')
    .filter((word) => word && !NOISE_WORDS.test(word))
    .join(' ')
    .trim();

  return { title: mainTitle || null, author: author || null };
}
