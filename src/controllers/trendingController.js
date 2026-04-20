import { getTrendingBooks, BOOK_CATEGORIES } from '../services/trendingBooksService.js';

// Récupérer les livres tendance du mois (avec filtre par catégorie optionnel)
export const getTrendingBooksController = async (req, res) => {
  try {
    // Récupérer la catégorie depuis les query params (ex: /api/trending/monthly?category=thriller)
    const { category = BOOK_CATEGORIES.ALL } = req.query;

    // Valider la catégorie
    const validCategories = Object.values(BOOK_CATEGORIES);
    const selectedCategory = validCategories.includes(category) ? category : BOOK_CATEGORIES.ALL;

    const trendingBooks = await getTrendingBooks(selectedCategory);

    res.status(200).json({
      success: true,
      data: trendingBooks,
      category: selectedCategory
    });
  } catch (error) {
    console.error('Erreur lors de la récupération des livres tendance:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des livres tendance'
    });
  }
};