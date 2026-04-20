import React, { useState, useEffect } from 'react';
import axiosAdmin from '../axiosAdmin';
import { toast } from 'react-toastify';
import styles from './BookRecommendations.module.css';

const BookRecommendations = ({ onSelectBook }) => {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState('');
  const [expanded, setExpanded] = useState(true);

  const fetchRecommendations = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axiosAdmin.get('/api/recommendations?limit=5');
      if (response.data.success) {
        setRecommendations(response.data.recommendations || []);
        setMessage(response.data.message || '');
      } else {
        setError(response.data.message || 'Erreur lors du chargement des recommandations');
      }
    } catch (err) {
      console.error('Erreur lors du chargement des recommandations:', err);
      setError(err.response?.data?.message || 'Impossible de charger les recommandations');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecommendations();
  }, []);

  const handleSelectBook = (rec) => {
    if (onSelectBook) {
      const bookData = {
        volumeInfo: {
          title: rec.title,
          authors: [rec.author],
          imageLinks: rec.thumbnail ? { thumbnail: rec.thumbnail } : null,
          description: rec.description || rec.reason,
          infoLink: rec.link || ''
        }
      };
      onSelectBook(bookData);
      toast.success(`"${rec.title}" ajouté au formulaire`);
    }
  };

  if (loading && recommendations.length === 0) {
    return (
      <div className={styles.recommendationsSection}>
        <div className={styles.header}>
          <h2 className={styles.title}>
            <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            Recommandations IA
          </h2>
        </div>
        <div className={styles.loadingContainer}>
          <div className={styles.spinner}></div>
          <p>L'IA joue au devin littéraire...</p>
        </div>
      </div>
    );
  }

  if (error && recommendations.length === 0) {
    return (
      <div className={styles.recommendationsSection}>
        <div className={styles.header}>
          <h2 className={styles.title}>
            <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            Recommandations IA
          </h2>
        </div>
        <div className={styles.errorContainer}>
          <p className={styles.errorMessage}>{error}</p>
          <button className={styles.retryButton} onClick={fetchRecommendations}>
            Réessayer
          </button>
        </div>
      </div>
    );
  }

  if (recommendations.length === 0) return null;

  return (
    <div className={styles.recommendationsSection}>
      <div className={styles.header}>
        <h2 className={styles.title}>
          <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          Recommandations IA
        </h2>
        <div className={styles.headerActions}>
          {message && <span className={styles.subtitle}>{message}</span>}
          <button
            className={styles.refreshButton}
            onClick={fetchRecommendations}
            disabled={loading}
            title="Nouvelles recommandations"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={loading ? styles.spinning : ''}>
              <polyline points="23 4 23 10 17 10"></polyline>
              <polyline points="1 20 1 14 7 14"></polyline>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
          </button>
          <button
            className={styles.toggleButton}
            onClick={() => setExpanded(!expanded)}
            aria-label={expanded ? "Réduire" : "Développer"}
          >
            <svg
              className={`${styles.chevron} ${expanded ? styles.expanded : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
        </div>
      </div>

      {expanded && (
        <div className={styles.recList}>
          {recommendations.map((rec, index) => (
            <div
              key={rec.id || index}
              className={styles.recCard}
              onClick={() => handleSelectBook(rec)}
            >
              <div className={styles.recCover}>
                {rec.thumbnail ? (
                  <img src={rec.thumbnail} alt={rec.title} className={styles.recCoverImg} />
                ) : (
                  <div className={styles.noCover}>📚</div>
                )}
              </div>

              <div className={styles.recInfo}>
                <div className={styles.recTitleRow}>
                  <h4 className={styles.recTitle}>{rec.title}</h4>
                  {rec.genre && rec.genre !== 'Non spécifié' && (
                    <span className={styles.genreBadge}>{rec.genre}</span>
                  )}
                </div>
                <p className={styles.recAuthor}>{rec.author}</p>
                {rec.reason && (
                  <p className={styles.recReason}>{rec.reason}</p>
                )}
              </div>

              <div className={styles.recChevron}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9 18 6-6-6-6"/>
                </svg>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default BookRecommendations;
