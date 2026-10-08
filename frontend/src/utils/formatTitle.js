// Nettoyage d'affichage pour les titres issus de releases scene/P2P (ex: Prowlarr),
// du type "Frieren.Anthologie.T01.TSUKASA.ABE.FRENCH.[CBZ]-ebdz". Purement cosmétique,
// ne doit jamais être utilisé pour les correspondances de fichiers ou les recherches.
export function formatDisplayTitle(title) {
  if (!title || typeof title !== 'string') return title;

  // Pas de points multiples type "nom.de.fichier" -> on considère que ce n'est
  // pas une release scene, on laisse le titre tel quel (ex: titres FR normaux).
  if (!/\.[A-Za-z0-9]/.test(title) || !title.includes('.')) return title;

  let cleaned = title
    .replace(/\[[^\]]*\]/g, ' ')       // tags entre crochets : [CBZ], [FRENCH]...
    .replace(/-[a-zA-Z0-9]+$/, ' ')    // suffixe groupe de release : -ebdz
    .replace(/[._]+/g, ' ')            // points/underscores -> espaces
    .replace(/\s+/g, ' ')
    .trim();

  // Après le tome, les releases scene ajoutent auteur/langue/format qu'on ne
  // peut pas distinguer du titre mot à mot : on coupe tout après le marqueur
  // de tome pour ne garder que "Titre T01".
  const tomeMatch = cleaned.match(/\b(T|Tome|Vol|Volume)\.?\s?\d+\b/i);
  if (tomeMatch) {
    return cleaned.slice(0, tomeMatch.index + tomeMatch[0].length) || title;
  }

  // Pas de tome : motif "Titre.Prénom.Nom.Année.Langue..." — les 2 mots juste
  // avant l'année sont l'auteur (pas le titre), ex. "Guillaume.Musso" dans
  // "Angélique.Guillaume.Musso.2022.fr.[ePub]-NoTag".
  const yearMatch = cleaned.match(/\b(19|20)\d{2}\b/);
  if (yearMatch) {
    const before = cleaned.slice(0, yearMatch.index).trim().split(/\s+/).filter(Boolean);
    if (before.length >= 3) {
      return before.slice(0, -2).join(' ') || title;
    }
  }

  return cleaned || title;
}
