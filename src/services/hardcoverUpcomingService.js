import axios from 'axios';
import { getHardcoverApiKey, takeHardcoverQuota } from './hardcoverConfig.js';

// Deuxième source de "Prochaines sorties" (issue #52), en complément du flux
// BnF — catalogue Hardcover à dominante anglophone, ne recoupe quasiment
// jamais les parutions françaises de la BnF. Contrairement à BnF, l'API
// fournit directement une vraie couverture et un genre (quand disponible),
// pas besoin de passer par bookSearchService pour enrichir.
const HARDCOVER_GRAPHQL_URL = 'https://api.hardcover.app/v1/graphql';
const PAGE_SIZE = 100;
const MAX_PAGES = 3; // jusqu'à 300 titres/jour, largement suffisant et reste loin du quota partagé (60 req/min)

const QUERY = `
  query UpcomingReleases($releaseDate: date!, $limit: Int!, $offset: Int!) {
    books(
      where: { release_date: { _gte: $releaseDate } }
      order_by: { release_date: asc }
      limit: $limit
      offset: $offset
    ) {
      id
      slug
      title
      release_date
      image { url }
      contributions { author { name } }
      genres: cached_tags(path: "Genre")
    }
  }
`;

function normalize(book) {
  const releaseDate = book.release_date ? new Date(`${book.release_date}T00:00:00Z`) : null;
  if (!releaseDate) return null;

  const author = (book.contributions || [])
    .map(c => c.author?.name)
    .filter(Boolean)
    .join(', ');

  // On ne garde que le tag de genre le plus pertinent (le premier renvoyé,
  // déjà trié par pertinence côté Hardcover) — la plupart des titres
  // auto-publiés n'en ont aucun, ce qui reste cohérent avec BnF.
  const genre = book.genres?.[0]?.tag?.trim() || '';

  return {
    source: 'hardcover',
    externalId: String(book.id),
    title: book.title,
    author,
    publisher: '',
    genre,
    releaseDate,
    coverUrl: book.image?.url || '',
    link: book.slug ? `https://hardcover.app/books/${book.slug}` : '',
  };
}

export async function fetchHardcoverUpcomingReleases() {
  const apiKey = await getHardcoverApiKey();
  if (!apiKey) return [];

  const auth = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
  const releaseDate = new Date().toISOString().slice(0, 10);

  const results = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    if (!takeHardcoverQuota()) {
      console.warn('[HardcoverUpcomingService] Quota Hardcover atteint, arrêt anticipé de la pagination');
      break;
    }
    let books;
    try {
      const res = await axios.post(
        HARDCOVER_GRAPHQL_URL,
        { query: QUERY, variables: { releaseDate, limit: PAGE_SIZE, offset: page * PAGE_SIZE } },
        { headers: { 'Content-Type': 'application/json', Authorization: auth }, timeout: 15000 }
      );
      if (res.data?.errors) throw new Error(res.data.errors[0]?.message || 'Erreur Hardcover');
      books = res.data?.data?.books || [];
    } catch (err) {
      console.warn('[HardcoverUpcomingService] Erreur:', err.message);
      break;
    }
    if (books.length === 0) break;
    for (const book of books) {
      const normalized = normalize(book);
      if (normalized) results.push(normalized);
    }
    if (books.length < PAGE_SIZE) break;
  }
  return results;
}
