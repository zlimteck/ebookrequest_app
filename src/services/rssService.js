import fetch from 'node-fetch';
import { parseStringPromise } from 'xml2js';

const RSS_BASE_URL = process.env.RSS_FEED_URL || 'https://predb.me/?cats=books-ebooks&rss=1';

function normalizeString(str) {
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

// Extrait auteur et titre depuis le format predb.me
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

function calculateMatchScore(searchTitle, searchAuthor, rssTitle, rssAuthor, rssFullText) {
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
  let url = RSS_BASE_URL;
  if (searchQuery) {
    url += `&search=${encodeURIComponent(searchQuery)}`;
  }

  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EbookRequest/1.0)' },
    timeout: 10000
  });

  if (!response.ok) {
    throw new Error(`Erreur HTTP: ${response.status}`);
  }

  const xmlText = await response.text();
  const result = await parseStringPromise(xmlText, { explicitArray: false, trim: true });
  const items = result?.rss?.channel?.item || [];
  return Array.isArray(items) ? items : [items];
}

export async function checkBookAvailability(title, author) {
  try {
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
