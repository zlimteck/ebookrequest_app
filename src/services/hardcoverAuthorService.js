import axios from 'axios';
import { getHardcoverApiKey, takeHardcoverQuota } from './hardcoverConfig.js';

const HARDCOVER_TIMEOUT = 10000;

/**
 * Enrichissement optionnel (Hardcover activé par l'admin uniquement) : utilisé
 * seulement quand Open Library n'a pas pu fournir de nom en alphabet latin
 * (voir openLibraryAuthorService.js, pickBestName) — jamais appelé pour
 * chaque résultat d'une recherche, seulement au moment du suivi/détail d'un
 * auteur précis, pour ne pas consommer le quota 60 req/min partagé avec le
 * reste de l'app.
 */
export async function enrichAuthorFromHardcover(name) {
  const apiKey = await getHardcoverApiKey();
  if (!apiKey) return null;
  if (!takeHardcoverQuota()) {
    console.warn('[Authors] Hardcover quota (60 req/min) atteint, enrichissement ignoré');
    return null;
  }

  try {
    const res = await axios.post(
      'https://api.hardcover.app/v1/graphql',
      {
        query: `query FindAuthor($name: String!) {
          authors(where: { name: { _ilike: $name } }, limit: 1) {
            name
            alternate_names
            bio
            image { url }
          }
        }`,
        variables: { name: `%${name}%` },
      },
      {
        timeout: HARDCOVER_TIMEOUT,
        headers: {
          'Content-Type': 'application/json',
          Authorization: apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`,
        },
      }
    );
    if (res.data?.errors) throw new Error(res.data.errors[0]?.message || 'Erreur Hardcover');
    const author = res.data?.data?.authors?.[0];
    if (!author) return null;
    return {
      name: author.name || '',
      alternateNames: Array.isArray(author.alternate_names) ? author.alternate_names : [],
      bio: author.bio || '',
      photoUrl: author.image?.url || '',
    };
  } catch (err) {
    console.warn('[Authors] Échec enrichissement Hardcover:', err.message);
    return null;
  }
}
