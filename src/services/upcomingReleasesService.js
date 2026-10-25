import axios from 'axios';
import { parseStringPromise } from 'xml2js';
import { findBestBookMatch } from './bookSearchService.js';
import ConnectorSettings from '../models/ConnectorSettings.js';

// Activable/désactivable globalement par un admin (même convention que
// authorFollow) — `enabled` générique du schéma, true par défaut tant que
// l'admin n'a jamais touché au réglage.
export async function getUpcomingReleasesConfig() {
  const doc = await ConnectorSettings.findOne({ service: 'upcomingReleases' }).lean();
  return {
    enabled: doc?.enabled ?? true,
    hardcoverLanguage: doc?.upcomingReleasesHardcoverLanguage ?? 'all',
  };
}

// Flux RSS public de Nouveautés Éditeurs (BnF) — déclarations de dépôt légal
// des éditeurs, visibles jusqu'à 6 mois avant la date de parution réelle.
// Public, sans clé API ni authentification (vérifié en conditions réelles,
// voir issue #52).
const BNF_FEED_URL = 'https://nouveautes-editeurs.bnf.fr/neRss?type=livre';
const FETCH_TIMEOUT_MS = 15000;

// La description de chaque item contient "Auteur : X", "Editeur : Y",
// "Date de parution : JJ/MM/AAAA" en texte brut dans des balises <p> — c'est
// la seule source fiable de la vraie date de sortie (pubDate/dc:date du flux
// reflètent juste la date d'ajout au flux, pas la parution).
function parseDescription(description) {
  const text = (description || '').replace(/<[^>]+>/g, '\n');
  const author = text.match(/Auteur\s*:\s*([^\n]+)/i)?.[1]?.trim() || '';
  const publisher = text.match(/Editeur\s*:\s*([^\n]+)/i)?.[1]?.trim() || '';
  const dateMatch = text.match(/Date de parution\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  const releaseDate = dateMatch ? new Date(Date.UTC(+dateMatch[3], +dateMatch[2] - 1, +dateMatch[1])) : null;
  return { author, publisher, releaseDate };
}

// L'auteur est au format "NOM Prénom" (BnF) — on le garde tel quel pour
// l'affichage (cohérent avec la source), mais un format "Prénom NOM" marche
// mieux pour la recherche croisée Google Books/Hardcover, d'où la variante
// inversée tentée en repli dans enrichCoverIfGeneric.
function invertName(author) {
  const parts = author.trim().split(/\s+/);
  if (parts.length < 2) return author;
  return [...parts.slice(1), parts[0]].join(' ');
}

function extractDeclarationId(link) {
  return link?.match(/id_declaration=(\d+)/)?.[1] || null;
}

async function fetchFeed() {
  const res = await axios.get(BNF_FEED_URL, { timeout: FETCH_TIMEOUT_MS });
  const parsed = await parseStringPromise(res.data, { explicitArray: false, trim: true });
  const items = parsed?.rss?.channel?.item || [];
  return Array.isArray(items) ? items : [items];
}

// L'enclosure du flux est une icône SVG générique (image.html?...), jamais
// une vraie couverture — toujours considérée comme "à enrichir".
function isGenericIcon(enclosureUrl) {
  return !enclosureUrl || enclosureUrl.includes('image.html');
}

/**
 * Repli sur la cascade déjà existante (Google Books → Hardcover → Open
 * Library) pour récupérer une vraie couverture. Appelé uniquement pour les
 * nouvelles annonces (voir upcomingReleasesCron.js) — jamais pour les ~150
 * items du flux à chaque passage, pour ne pas marteler le quota API partagé
 * une fois par jour pour rien (la plupart des annonces ne changent pas d'un
 * cycle à l'autre).
 */
export async function resolveCoverUrl(title, author) {
  try {
    const match = await findBestBookMatch({ title, author: invertName(author) });
    return match?.thumbnail || '';
  } catch {
    return '';
  }
}

/**
 * Récupère et normalise les annonces du flux BnF dont la date de parution
 * est aujourd'hui ou dans le futur (les annonces déjà passées ne sont jamais
 * gardées, même si elles restent un moment dans le flux). Ne résout pas les
 * couvertures ici — voir resolveCoverUrl, appelé séparément par le cron
 * seulement pour les annonces réellement nouvelles.
 */
export async function fetchUpcomingReleases() {
  const items = await fetchFeed();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // Une même parution peut être déclarée plusieurs fois sous des
  // id_declaration distincts (ex. formats papier et numérique déclarés
  // séparément par l'éditeur) — on ne garde que la première occurrence par
  // titre+auteur+date pour éviter les doublons visuels dans la liste.
  const seen = new Set();
  const results = [];
  for (const item of items) {
    const externalId = extractDeclarationId(item.link);
    if (!externalId) continue;

    const { author, publisher, releaseDate } = parseDescription(item.description);
    if (!releaseDate || releaseDate < today) continue;

    const dedupeKey = `${item.title.trim().toLowerCase()}|${author.trim().toLowerCase()}|${releaseDate.getTime()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const enclosureUrl = item.enclosure?.$?.url || '';

    results.push({
      source: 'bnf',
      externalId,
      title: item.title,
      author,
      publisher,
      releaseDate,
      coverUrl: isGenericIcon(enclosureUrl) ? '' : enclosureUrl,
      link: item.link || '',
    });
  }
  return results;
}
