import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axiosAdmin from '../../axiosAdmin';
import { toast } from 'react-toastify';
import styles from './UserDashboard.module.css';
import BookPreviewModal from '../../components/BookPreviewModal';

const DiscoverPage = () => {
  const [trendingBooks, setTrendingBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const navigate = useNavigate();
  const filterBarRef = useRef(null);
  const [previewBook, setPreviewBook] = useState(null);

  // Définition des catégories
  const categories = [
    { id: 'all', label: 'Tous', icon: '📚' },
    { id: 'thriller', label: 'Thriller & Policier', icon: '🔍' },
    { id: 'romance', label: 'Romance', icon: '💕' },
    { id: 'sf', label: 'Science-Fiction', icon: '🚀' },
    { id: 'bd', label: 'BD & Manga', icon: '📖' },
    { id: 'fantasy', label: 'Fantasy', icon: '🐉' },
    { id: 'literary', label: 'Littéraire', icon: '✍️' }
  ];

  useEffect(() => {
    fetchTrendingBooks(selectedCategory);
  }, [selectedCategory]);

  const fetchTrendingBooks = async (category) => {
    setLoading(true);
    try {
      const response = await axiosAdmin.get(`/api/trending/monthly?category=${category}`);
      if (response.data.success) {
        setTrendingBooks(response.data.data);
      }
    } catch (error) {
      console.error('Erreur lors de la récupération des livres tendance:', error);
      toast.error('Erreur lors du chargement des livres tendance');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestBook = (book) => {
    // Rediriger vers la page de nouvelle demande avec les données pré-remplies
    navigate('/', {
      state: {
        prefillData: {
          title: book.title,
          author: book.author,
          link: book.link,
          thumbnail: book.thumbnail,
          description: book.description,
          pageCount: book.pageCount
        }
      }
    });
  };

  if (loading) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.loadingSpinner}></div>
        <p>Chargement des livres tendance...</p>
      </div>
    );
  }

  return (
    <div className={styles.dashboardContainer}>
      {previewBook && <BookPreviewModal book={previewBook} onClose={() => setPreviewBook(null)} />}
      <h1>Découvrir</h1>

      {/* Onglets de filtres par catégorie */}
      <div className={styles.filterBarWrapper}>
        <div className={styles.filterBar} ref={filterBarRef}>
          {categories.map(category => (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id)}
              className={`${styles.filterPill} ${selectedCategory === category.id ? styles.filterPillActive : ''}`}
            >
              <span>{category.icon}</span>
              <span>{category.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.requestsGrid}>
        {trendingBooks.map((book, index) => (
          <div key={book.id} className={`${styles.requestCard} ${styles.cardPending}`}>
            {/* Cover sidebar */}
            <div className={styles.bookCover} onClick={() => setPreviewBook(book)}>
              {book.thumbnail ? (
                <img
                  src={book.thumbnail}
                  alt={book.title}
                  className={styles.coverImage}
                  onError={(e) => {
                    e.target.style.display = 'none';
                    e.target.nextElementSibling.style.display = 'flex';
                  }}
                />
              ) : null}
              <div className={styles.noCoverPlaceholder} style={{ display: book.thumbnail ? 'none' : 'flex' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                </svg>
              </div>
            </div>

            <div className={styles.requestContent}>
              <div className={styles.requestHeader}>
                <h3 className={styles.requestTitle}>{book.title}</h3>
                <span className={`${styles.statusBadge} ${styles.pendingBadge}`}>
                  #{index + 1}
                </span>
              </div>

              <p className={styles.requestAuthor}>{book.author}</p>

              {book.pageCount > 0 && (
                <div className={styles.metaRow}>
                  <span className={styles.pagesBadge}>{book.pageCount} pages</span>
                </div>
              )}

              {book.description && (
                <p className={styles.bookDescription}>{book.description}</p>
              )}

              <div className={styles.actionStrip}>
                <div className={styles.actionIcons}>
                  <button className={`${styles.discoverBtn} ${styles.discoverBtnPrimary}`} onClick={() => handleRequestBook(book)} title="Demander ce livre">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                  </button>
                  {book.link && (
                    <a href={book.link} target="_blank" rel="noopener noreferrer" className={`${styles.iconBtn}`} title="Voir le livre">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                        <polyline points="15 3 21 3 21 9"/>
                        <line x1="10" y1="14" x2="21" y2="3"/>
                      </svg>
                    </a>
                  )}
                </div>
                <span className={styles.requestDate}>🔥 Tendance</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {trendingBooks.length === 0 && (
        <div className={styles.emptyState}>
          <p>Aucun livre tendance disponible pour le moment.</p>
        </div>
      )}
    </div>
  );
};

export default DiscoverPage;