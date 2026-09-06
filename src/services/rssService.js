import fetch from 'node-fetch';
import axios from 'axios';
import { parseStringPromise } from 'xml2js';
import { getRSSFeedUrl } from './rssConfig.js';

// Même mécanisme que annasArchiveService.js — predb.me est derrière Cloudflare
// (challenge JS), qu'aucun fetch() serveur ne peut passer seul. On tente
// d'abord un accès direct (rapide, marche pour les sites non protégés), puis
// on se replie sur FlareSolverr (navigateur headless qui résout le challenge)
// si ça échoue.
const FLARESOLVERR_URL = process.env.FLARESOLVERR_URL || 'http://flaresolverr:8191';
const SOLVER_TIMEOUT_MS = 20000;
const REALISTIC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function cfFetchRSS(url) {
  console.log(`[PreDB Check] Accès direct échoué, essai via FlareSolverr…`);
  const res = await axios.post(
    `${FLARESOLVERR_URL}/v1`,
    { cmd: 'request.get', url, maxTimeout: SOLVER_TIMEOUT_MS },
    { timeout: SOLVER_TIMEOUT_MS + 15000 }
  );
  if (res.data?.status !== 'ok') {
    throw new Error(`FlareSolverr erreur: ${res.data?.message || 'unknown'}`);
  }
  return res.data.solution?.response || '';
}

export function normalizeString(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['']/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export // Extrait auteur et titre depuis le format predb.me
// Ex: "Jeff.Kinney.-.Diary.Of.A.Wimpy.Kid.2025.RETAIL.EPUB.eBook-CTO"
// Ex: "Wensley.Clarkson.The.Good.Doctor.2002.RETAiL.EPUB.eBook-NODE" (sans séparateur)
function extractBookInfo(releaseTitle) {
  if (!releaseTitle) return { title: '', author: '', fullText: '' };

  // Supprimer l'année et tout ce qui suit
  let cleaned = releaseTitle.replace(/\.\d{4}[\.\-].*$/i, '');

  // Fallback si pas d'année trouvée
  if (cleaned === releaseTitle) {
    cleaned = releaseTitle
      .replace(/\.(RETAIL|RETAiL|EPUB|PDF|MOBI|AZW3|eBook|ebook).*$/i, '')
      .replace(/-\w+$/, ''); // retirer le group tag
  }

  let author = '';
  let title = '';

  // Format avec séparateur " - " encodé en ".-.":
  if (cleaned.includes('.-.')) {
    const sepIdx = cleaned.indexOf('.-.');
    author = cleaned.slice(0, sepIdx).replace(/\./g, ' ').trim();
    title = cleaned.slice(sepIdx + 3).replace(/\./g, ' ').trim();
  } else {
    // Sans séparateur : les 2 premiers segments = auteur, reste = titre
    const parts = cleaned.split('.');
    if (parts.length >= 3) {
      author = parts.slice(0, 2).join(' ');
      title = parts.slice(2).join(' ');
    } else {
      title = parts.join(' ');
    }
  }

  const fullText = cleaned.replace(/\./g, ' ').trim();
  return { title: title.trim(), author: author.trim(), fullText };
}

export function calculateMatchScore(searchTitle, searchAuthor, rssTitle, rssAuthor, rssFullText) {
  const normSearchTitle = normalizeString(searchTitle);
  const normSearchAuthor = normalizeString(searchAuthor);
  const normRssTitle = normalizeString(rssTitle);
  const normRssAuthor = normalizeString(rssAuthor);
  const normFullText = normalizeString(rssFullText);

  let score = 0;

  const calculateWordOverlap = (str1, str2) => {
    if (!str1 || !str2) return 0;
    const words1 = new Set(str1.split(' ').filter(w => w.length > 2));
    const words2 = new Set(str2.split(' ').filter(w => w.length > 2));
    if (words1.size === 0 || words2.size === 0) return 0;
    const intersection = [...words1].filter(w => words2.has(w));
    return (intersection.length / Math.min(words1.size, words2.size)) * 100;
  };

  if (normSearchTitle && normRssTitle) {
    if (normSearchTitle === normRssTitle) {
      score += 60;
    } else if (normRssTitle.includes(normSearchTitle) || normSearchTitle.includes(normRssTitle)) {
      score += 50;
    } else if (normFullText.includes(normSearchTitle)) {
      score += 40;
    } else {
      const overlap = calculateWordOverlap(normSearchTitle, normRssTitle);
      if (overlap >= 70) score += 45;
      else if (overlap >= 50) score += 35;
      else if (overlap >= 30) score += 25;
    }
  }

  if (normSearchAuthor && (normRssAuthor || normFullText)) {
    if (normRssAuthor && normSearchAuthor === normRssAuthor) {
      score += 40;
    } else if (normRssAuthor && (normRssAuthor.includes(normSearchAuthor) || normSearchAuthor.includes(normRssAuthor))) {
      score += 35;
    } else if (normFullText.includes(normSearchAuthor)) {
      score += 30;
    } else if (normRssAuthor) {
      const overlap = calculateWordOverlap(normSearchAuthor, normRssAuthor);
      if (overlap >= 70) score += 35;
      else if (overlap >= 50) score += 25;
    }
  }

  return score;
}

async function fetchRSSFeed(searchQuery = '') {
  let url = await getRSSFeedUrl();
  if (!url) return []; // désactivé côté admin — aucun appel HTTP
  if (searchQuery) {
    url += `&search=${encodeURIComponent(searchQuery)}`;
  }

  let xmlText;
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': REALISTIC_UA },
      timeout: 10000
    });
    if (!response.ok) throw new Error(`Erreur HTTP: ${response.status}`);
    xmlText = await response.text();
  } catch (directErr) {
    try {
      xmlText = await cfFetchRSS(url);
    } catch (solverErr) {
      console.warn(`[PreDB Check] FlareSolverr a aussi échoué: ${solverErr.message}`);
      throw directErr; // erreur d'origine, plus parlante que celle du solveur
    }
  }

  // (patch) : FlareSolverr renvoie le rendu navigateur de la page, qui peut
  // envelopper le XML brut dans la visionneuse XML du navigateur plutôt que
  // le retourner tel quel — non vérifiable depuis cet environnement. Si le
  // parsing échoue après un passage par le solveur, ça se traduira par une
  // erreur explicite ici plutôt qu'un plantage silencieux.
  const result = await parseStringPromise(xmlText, { explicitArray: false, trim: true });
  const items = result?.rss?.channel?.item || [];
  return Array.isArray(items) ? items : [items];
}

export async function checkBookAvailability(title, author) {
  try {
    const feedUrl = await getRSSFeedUrl();
    if (!feedUrl) {
      return {
        available: false,
        confidence: 'unknown',
        message: 'Vérification PreDB désactivée par un administrateur',
        score: 0,
      };
    }

    console.log(`\n[PreDB Check] Recherche de: "${title}" par "${author}"`);

    // Deux recherches : par auteur et par titre
    const searchTerms = [
      author,
      title.split(' ').slice(0, 3).join(' ')
    ].filter(t => t && t.length > 2);

    const seenTitles = new Set();
    let allItems = [];

    for (const term of searchTerms) {
      try {
        const items = await fetchRSSFeed(term);
        console.log(`[PreDB Check] Recherche "${term}": ${items.length} résultats`);
        for (const item of items) {
          const t = item.title || '';
          if (!seenTitles.has(t)) {
            seenTitles.add(t);
            allItems.push(item);
          }
        }
      } catch (err) {
        console.warn(`[PreDB Check] Erreur recherche "${term}":`, err.message);
      }
    }

    console.log(`[PreDB Check] Total unique: ${allItems.length}`);

    let bestMatch = null;
    let bestScore = 0;

    for (const item of allItems) {
      const rssTitle = item.title || '';
      const { title: extractedTitle, author: extractedAuthor, fullText } = extractBookInfo(rssTitle);
      const score = calculateMatchScore(title, author, extractedTitle, extractedAuthor, fullText);

      if (score >= 40) {
        console.log(`[PreDB Check] Score ${score}: "${rssTitle}"`);
        console.log(`  ↳ Titre: "${extractedTitle}", Auteur: "${extractedAuthor}"`);
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = { rssTitle, extractedTitle, extractedAuthor, link: item.link, score };
      }
    }

    console.log(`[PreDB Check] Meilleur score: ${bestScore}${bestMatch ? ` - "${bestMatch.rssTitle}"` : ''}\n`);

    if (bestScore >= 75) {
      return {
        available: true,
        confidence: 'high',
        message: 'Ce livre semble disponible ! Votre demande devrait être traitée rapidement.',
        match: bestMatch,
        score: bestScore
      };
    } else if (bestScore >= 45) {
      return {
        available: true,
        confidence: 'medium',
        message: 'Un livre similaire semble disponible. Votre demande pourrait être traitée rapidement.',
        match: bestMatch,
        score: bestScore
      };
    } else {
      return {
        available: false,
        confidence: 'low',
        message: 'Ce livre ne semble pas immédiatement disponible. Le traitement pourrait prendre plus de temps.',
        match: bestMatch,
        score: bestScore
      };
    }

  } catch (error) {
    console.error('Erreur lors de la vérification de disponibilité:', error);
    return {
      available: false,
      confidence: 'unknown',
      message: 'Impossible de vérifier la disponibilité pour le moment',
      error: error.message
    };
  }
}
