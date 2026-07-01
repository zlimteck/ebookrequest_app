import axios from 'axios';
import Bestseller from '../models/Bestseller.js';

const GOOGLE_BOOKS_API_KEY = process.env.GOOGLE_BOOKS_API_KEY;

// Cache pour les livres tendance par catégorie
let cachedBooksByCategory = {};
let lastFetchTimeByCategory = {}; // Timestamp par catégorie
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 heures en millisecondes

// Définition des catégories disponibles
export const BOOK_CATEGORIES = {
  ALL: 'all',
  THRILLER: 'thriller',
  ROMANCE: 'romance',
  SF: 'sf',
  BD: 'bd',
  FANTASY: 'fantasy',
  LITERARY: 'literary'
};

// Récupère les livres tendance avec cache de 24h (par catégorie)
export async function getTrendingBooks(category = BOOK_CATEGORIES.ALL) {
  // Vérifier si le cache est encore valide pour cette catégorie spécifique
  const now = Date.now();
  const categoryLastFetch = lastFetchTimeByCategory[category];

  if (cachedBooksByCategory[category] && categoryLastFetch && (now - categoryLastFetch) < CACHE_DURATION) {
    const remainingTime = Math.round((CACHE_DURATION - (now - categoryLastFetch)) / 1000 / 60 / 60);
    console.log(`📦 Utilisation du cache pour "${category}" (rafraîchissement dans ${remainingTime}h)`);
    return cachedBooksByCategory[category];
  }

  // Cache expiré ou inexistant, récupérer de nouvelles données
  console.log(`🔄 Récupération de nouveaux livres pour la catégorie "${category}"...`);
  const books = await fetchTrendingBooks(category);

  // Mettre à jour le cache pour cette catégorie spécifique
  cachedBooksByCategory[category] = books;
  lastFetchTimeByCategory[category] = now;

  return books;
}

// Fonction interne pour récupérer les livres (appelée seulement quand le cache expire)
async function fetchTrendingBooks(category = BOOK_CATEGORIES.ALL) {
  try {
    console.log(`🔍 Récupération des bestsellers pour "${category}"...`);

    // Récupérer les bestsellers depuis MongoDB
    const filter = { active: true };
    if (category !== BOOK_CATEGORIES.ALL) {
      filter.category = category;
    }

    const bestsellers = await Bestseller.find(filter)
      .sort({ order: 1, createdAt: -1 })
      .limit(10);

    console.log(`📚 ${bestsellers.length} livres à chercher...`);

    // Enrichir les bestsellers séquentiellement pour éviter le rate-limit Google Books
    const frenchBooks = [];
    for (const bestseller of bestsellers) {
      const { title, author } = bestseller;
      console.log(`🔎 Recherche: ${title} ${author ? `par ${author}` : ''}`);
      const googleData = await searchGoogleBooks(title, author);
      if (!googleData) {
        console.log(`⚠️  Non trouvé: ${title}`);
      } else {
        console.log(`✅ Trouvé: ${googleData.title}`);
        frenchBooks.push({
          id: googleData.id,
          title: googleData.title,
          author: googleData.author || author || 'Auteur inconnu',
          thumbnail: googleData.thumbnail,
          description: googleData.description || 'Aucune description disponible.',
          pageCount: googleData.pageCount || 0,
          link: googleData.link || `https://www.google.com/search?q=${encodeURIComponent(title)}`,
          trending_rank: frenchBooks.length + 1,
        });
      }
      // Délai entre chaque appel pour respecter le quota Google Books
      await sleep(300);
    }

    console.log(`✅ ${frenchBooks.length} livres récupérés pour "${category}"`);
    return frenchBooks;

  } catch (error) {
    console.error('Erreur lors de la récupération des bestsellers:', error);
    throw new Error('Impossible de récupérer les bestsellers');
  }
}

// Pré-charge le cache au démarrage du serveur (appelé depuis index.js)
export async function initializeTrendingBooksCache() {
  try {
    console.log('🚀 Initialisation du cache des livres tendance...');
    // Pré-charger les catégories séquentiellement pour éviter le rate-limit Google Books
    const allCategories = Object.values(BOOK_CATEGORIES);
    for (const cat of allCategories) {
      await getTrendingBooks(cat).catch(() => {});
      await sleep(500);
    }
    console.log('✅ Cache des livres tendance initialisé pour toutes les catégories');
  } catch (error) {
    console.error('❌ Erreur lors de l\'initialisation du cache:', error);
  }
}

// Fonction pour vider le cache (appelée quand on modifie les bestsellers)
export function clearTrendingBooksCache() {
  cachedBooksByCategory = {};
  lastFetchTimeByCategory = {};
  console.log('🗑️  Cache des livres tendance vidé');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function searchGoogleBooks(title, author) {
  if (!GOOGLE_BOOKS_API_KEY) {
    return null;
  }

  const query = author && author !== 'Auteur inconnu'
    ? `intitle:${title}+inauthor:${author}`
    : `intitle:${title}`;

  try {
    const response = await axios.get('https://www.googleapis.com/books/v1/volumes', {
      params: { q: query, key: GOOGLE_BOOKS_API_KEY, maxResults: 1, langRestrict: 'fr' }
    });

    if (response.data.items && response.data.items.length > 0) {
      const item = response.data.items[0];
      const book = item.volumeInfo;
      return {
        id: item.id,
        title: book.title || null,
        author: book.authors?.[0] || null,
        thumbnail: book.imageLinks?.thumbnail?.replace('http:', 'https:') ||
                   book.imageLinks?.smallThumbnail?.replace('http:', 'https:') || null,
        description: book.description || null,
        pageCount: book.pageCount || 0,
        link: book.infoLink || book.previewLink || null,
        language: book.language || 'unknown',
      };
    }
    return null;
  } catch (error) {
    if (error.response?.status !== 429) {
      console.error('Erreur lors de la recherche Google Books:', error.message);
    }
    return null;
  }
}