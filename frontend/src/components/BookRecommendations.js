import React, { useState, useEffect } from 'react';
import axiosAdmin from '../axiosAdmin';
import { toast } from 'react-toastify';
import styles from './BookRecommendations.module.css';

const BookRecommendations = ({ onSelectBook }) => {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState('');
  const [expanded, setExpanded] = useState(true);
  const [rateInfo, setRateInfo] = useState(null);
  // { regenerationsUsed, regenerationsMax, regenerationsRemaining, windowResetAt, generatedAt, cached }

  const applyResponse = (data) => {
    setRecommendations(data.recommendations || []);
    setMessage(data.message || '');
    setRateInfo({
      regenerationsUsed: data.regenerationsUsed ?? 0,
      regenerationsMax: data.regenerationsMax ?? 3,
      regenerationsRemaining: data.regenerationsRemaining ?? 3,
      windowResetAt: data.windowResetAt ? new Date(data.windowResetAt) : null,
      generatedAt: data.generatedAt ? new Date(data.generatedAt) : null,
      cached: data.cached ?? false,
    });
  };

  // Chargement initial — retourne le cache sans consommer de quota
  const fetchRecommendations = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axiosAdmin.get('/api/recommendations?limit=5');
      if (response.data.success) {
        applyResponse(response.data);
      } else {
        setError(response.data.message || 'Erreur lors du chargement des recommandations');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Impossible de charger les recommandations');
    } finally {
      setLoading(false);
    }
  };

  // Régénération manuelle — consomme 1 quota
  const handleRegenerate = async () => {
    if (regenerating) return;
    setRegenerating(true);
    setError(null);
    try {
      const response = await axiosAdmin.post('/api/recommendations/regenerate');
      if (response.data.success) {
        applyResponse(response.data);
        toast.success('Nouvelles recommandations générées !');
      } else {
        // Limite atteinte (429 capturé dans catch) ou autre erreur
        setError(response.data.message || 'Erreur lors de la régénération');
      }
    } catch (err) {
      const data = err.response?.data;
      if (err.response?.status === 429) {
        // On garde les recs en cache et on met à jour le rateInfo
        if (data?.recommendations?.length > 0) applyResponse(data);
        toast.error(data?.message || 'Limite de régénération atteinte');
      } else {
        setError(data?.message || 'Impossible de régénérer les recommandations');
      }
    } finally {
      setRegenerating(false);
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

  // ── Formatage de la date de reset ──
  const formatResetDate = (date) => {
    if (!date) return '';
    return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  };

  // ── Compteur de régénérations restantes ──
  const RegenCounter = () => {
    if (!rateInfo) return null;
    const { regenerationsRemaining, regenerationsMax, windowResetAt } = rateInfo;
    const limitReached = regenerationsRemaining === 0;
    return (
      <span
        className={styles.regenCounter}
        title={limitReached
          ? `Limite atteinte. Réinitialisation le ${formatResetDate(windowResetAt)}`
          : `${regenerationsRemaining} régénération${regenerationsRemaining > 1 ? 's' : ''} restante${regenerationsRemaining > 1 ? 's' : ''} sur ${regenerationsMax}`}
        style={{ color: limitReached ? 'var(--color-danger, #ef4444)' : 'var(--color-text-muted)' }}
      >
        {regenerationsRemaining}/{regenerationsMax}
      </span>
    );
  };

  // ── Vue chargement initial ──
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

  // ── Vue erreur sans recs en cache ──
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

  const limitReached = rateInfo?.regenerationsRemaining === 0;

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

          <RegenCounter />

          <button
            className={styles.refreshButton}
            onClick={handleRegenerate}
            disabled={regenerating || limitReached}
            title={
              limitReached
                ? `Limite atteinte — réinitialisation le ${formatResetDate(rateInfo?.windowResetAt)}`
                : 'Nouvelles recommandations'
            }
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={regenerating ? styles.spinning : ''}>
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