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

// La langue n'est jamais un champ direct sur `books` côté Hardcover, c'est
// une propriété de ses éditions (`editions.language.code2`, ISO 639-1) — un
// même livre peut avoir plusieurs éditions dans des langues différentes,
// avec des dates de parution qui divergent (réédition, traduction tardive,
// etc.). Filtrer par langue filtre donc sur l'édition correspondante, pas
// sur le livre, et c'est aussi la date de CETTE édition qui est affichée
// (jamais `books.release_date`, qui peut être très différente — vérifié en
// conditions réelles sur un manga dont l'édition française datait de 2024
// alors que le livre lui-même était annoncé pour 2026).
const QUERY_ALL = `
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

const QUERY_BY_LANGUAGE = `
  query UpcomingReleasesByLanguage($releaseDate: date!, $lang: String!, $limit: Int!, $offset: Int!) {
    books(
      where: { editions: { language: { code2: { _eq: $lang } }, release_date: { _gte: $releaseDate } } }
      order_by: { release_date: asc }
      limit: $limit
      offset: $offset
    ) {
      id
      slug
      title
      image { url }
      contributions { author { name } }
      genres: cached_tags(path: "Genre")
      editions(
        where: { language: { code2: { _eq: $lang } }, release_date: { _gte: $releaseDate } }
        order_by: { release_date: asc }
        limit: 1
      ) {
        release_date
      }
    }
  }
`;

// Hardcover utilise des dates sentinelles ("2099-12-31", "2200-01-01", etc.)
// pour signaler une date de parution inconnue/non confirmée — jamais de
// vraies annonces de sortie, vérifié en conditions réelles (ex. "Cinn" sans
// date du tout, "La justice céleste" datée 2099). Tout ce qui dépasse cette
// fenêtre est traité comme non renseigné plutôt qu'affiché tel quel.
const MAX_PLAUSIBLE_YEARS_AHEAD = 2;

function normalize(book) {
  const releaseDateStr = book.editions?.[0]?.release_date || book.release_date;
  if (!releaseDateStr) return null;

  const releaseDate = new Date(`${releaseDateStr}T00:00:00Z`);
  if (Number.isNaN(releaseDate.getTime())) return null;

  const maxPlausible = new Date();
  maxPlausible.setUTCFullYear(maxPlausible.getUTCFullYear() + MAX_PLAUSIBLE_YEARS_AHEAD);
  if (releaseDate > maxPlausible) return null;

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

/**
 * @param {string} language - 'all', ou un code ISO 639-1 ('fr', 'en', ...)
 *   pour ne garder que les livres ayant une édition à paraître dans cette
 *   langue (configurable dans Réglages > Prochaines sorties).
 */
export async function fetchHardcoverUpcomingReleases(language = 'all') {
  const apiKey = await getHardcoverApiKey();
  if (!apiKey) return [];

  const auth = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
  const releaseDate = new Date().toISOString().slice(0, 10);
  const query = language === 'all' ? QUERY_ALL : QUERY_BY_LANGUAGE;

  const results = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    if (!takeHardcoverQuota()) {
      console.warn('[HardcoverUpcomingService] Quota Hardcover atteint, arrêt anticipé de la pagination');
      break;
    }
    let books;
    try {
      const variables = { releaseDate, limit: PAGE_SIZE, offset: page * PAGE_SIZE };
      if (language !== 'all') variables.lang = language;
      const res = await axios.post(
        HARDCOVER_GRAPHQL_URL,
        { query, variables },
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
