export function infoLinkSourceLabel(link) {
  if (!link) return 'Google Books';
  if (link.includes('hardcover.app')) return 'Hardcover';
  if (link.includes('openlibrary.org')) return 'Open Library';
  if (link.includes('play.google.com')) return 'Google Play Livres';
  if (link.includes('amazon.')) return 'Amazon';
  if (link.includes('fnac.')) return 'Fnac';
  if (link.includes('google.com') || link.includes('books.google')) return 'Google Books';
  // Domaine non reconnu (future source, lien externe inattendu...) : éviter
  // d'afficher un faux "Google Books" trompeur.
  return 'la fiche';
}

const isGoogleBooksLink = (link) => !!link && (link.includes('google.com') || link.includes('books.google'));
const isHardcoverLink = (link) => !!link && link.includes('hardcover.app');

// Lien Google Books : celui de la demande si c'en est déjà un, sinon une
// recherche (toujours disponible, même sans infoLink stocké — ex. demandes
// créées via recherche directe Valentine/Fourtoutici).
export function buildGoogleBooksLink(book) {
  if (isGoogleBooksLink(book.link)) return book.link;
  return `https://www.google.com/search?tbm=bks&q=${encodeURIComponent(`${book.title} ${book.author || ''}`.trim())}`;
}

// Même principe pour Hardcover.
export function buildHardcoverLink(book) {
  if (isHardcoverLink(book.link)) return book.link;
  return `https://hardcover.app/search?q=${encodeURIComponent(`${book.title} ${book.author || ''}`.trim())}`;
}

// true si `link` est déjà couvert par un des deux boutons dédiés ci-dessus
// (évite d'afficher le même lien une 2e fois sous "Voir sur Google Books/Hardcover").
export function isCoveredByDedicatedButton(link) {
  return isGoogleBooksLink(link) || isHardcoverLink(link);
}
