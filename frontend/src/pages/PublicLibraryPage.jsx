import React, { useEffect, useState } from 'react';
import axiosAdmin from '../axiosAdmin';
import { formatDisplayTitle } from '../utils/formatTitle';
import styles from './PublicLibraryPage.module.css';

const CATEGORY_LABELS = { ebook: 'Ebook', comic: 'BD', manga: 'Manga' };

const STATUS_FILTERS = [
  { id: 'all', label: 'Tous' },
  { id: 'read', label: 'Lus' },
  { id: 'reading', label: 'En cours' },
  { id: 'unread', label: 'Non lus' },
];

const CATEGORY_FILTERS = [
  { id: 'all', label: 'Tout' },
  { id: 'ebook', label: 'Ebooks' },
  { id: 'comic', label: 'BD / Comics' },
  { id: 'manga', label: 'Mangas' },
];

const Stars = ({ rating }) => (
  <div className={styles.stars}>
    {[1, 2, 3, 4, 5].map(n => (
      <svg key={n} width="13" height="13" viewBox="0 0 24 24"
        fill={n <= rating ? '#f59e0b' : 'none'} stroke={n <= rating ? '#f59e0b' : 'var(--color-text-muted)'}
        strokeWidth="2">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ))}
  </div>
);

export default function PublicLibraryPage() {
  // useParams() ne fonctionne pas hors de <Routes> — même pattern que ResetPassword.jsx.
  const token = window.location.pathname.split('/library/')[1];
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedBook, setSelectedBook] = useState(null);

  useEffect(() => {
    axiosAdmin.get(`/api/reading/public/${token}`)
      .then(res => setData(res.data))
      .catch(err => setError(err.response?.data?.message || 'Bibliothèque introuvable.'));
  }, [token]);

  if (error) {
    return (
      <div className={styles.page}>
        <div className={styles.centerMessage}>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={styles.page}>
        <div className={styles.loading}><div className={styles.spinner} /></div>
      </div>
    );
  }

  const isReading = (b) => b.status !== 'read' && b.readingProgress > 0;

  const books = data.books.filter(b => {
    if (filter === 'read' && b.status !== 'read') return false;
    if (filter === 'reading' && !isReading(b)) return false;
    if (filter === 'unread' && (b.status !== 'unread' || isReading(b))) return false;

    if (categoryFilter !== 'all' && b.category !== categoryFilter) return false;

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const haystack = `${formatDisplayTitle(b.title)} ${b.author}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }

    return true;
  });
  const readCount = data.books.filter(b => b.status === 'read').length;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <img src="/img/logo.png" alt="EbookRequest" className={styles.logo} />
        <h1 className={styles.title}>Bibliothèque de {data.username}</h1>
        <p className={styles.subtitle}>{data.books.length} livre{data.books.length > 1 ? 's' : ''} · {readCount} lu{readCount > 1 ? 's' : ''}</p>
      </div>

      <div className={styles.toolbar}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Rechercher par titre ou auteur..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className={styles.selectRow}>
          <select
            className={styles.filterSelect}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            {STATUS_FILTERS.map(f => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
          <select
            className={styles.filterSelect}
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            {CATEGORY_FILTERS.map(f => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
        </div>
      </div>

      {books.length === 0 ? (
        <p className={styles.empty}>Aucun livre dans cette catégorie.</p>
      ) : (
        <div className={styles.grid}>
          {books.map((b, i) => (
            <div key={i} className={styles.card}>
              <div className={styles.thumbWrap} onClick={() => setSelectedBook(b)}>
                {b.thumbnail ? (
                  <img src={b.thumbnail} alt="" className={styles.thumb} />
                ) : (
                  <div className={styles.thumbPlaceholder}>
                    <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                    </svg>
                  </div>
                )}
                <span className={`${styles.badge} ${b.status === 'read' ? styles.badgeRead : isReading(b) ? styles.badgeReading : styles.badgeUnread}`}>
                  {b.status === 'read' ? 'Lu' : isReading(b) ? 'En cours' : 'Non lu'}
                </span>
                {isReading(b) && (
                  <div className={styles.cardProgress}>
                    <div className={styles.cardProgressFill} style={{ width: `${b.readingProgress}%` }} />
                  </div>
                )}
              </div>
              <p className={styles.cardTitle} title={formatDisplayTitle(b.title)}>{formatDisplayTitle(b.title)}</p>
              <p className={styles.cardAuthor}>{b.author}</p>
              {b.rating > 0 && <Stars rating={b.rating} />}
              {b.notes && <p className={styles.cardNotes}>{b.notes}</p>}
            </div>
          ))}
        </div>
      )}

      <p className={styles.footer}>
        Propulsé par <a href="https://ebookrequest.fr" target="_blank" rel="noopener noreferrer">EbookRequest</a>
      </p>

      {selectedBook && (
        <div className={styles.modalOverlay} onClick={(e) => { if (e.target === e.currentTarget) setSelectedBook(null); }}>
          <div className={styles.modal}>
            <button type="button" className={styles.modalClose} onClick={() => setSelectedBook(null)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
            <div className={styles.modalThumb}>
              {selectedBook.thumbnail ? (
                <img src={selectedBook.thumbnail} alt="" />
              ) : (
                <div className={styles.thumbPlaceholder}>
                  <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  </svg>
                </div>
              )}
            </div>
            <div className={styles.modalBody}>
              <p className={styles.modalTitle}>{formatDisplayTitle(selectedBook.title)}</p>
              <p className={styles.modalAuthor}>{selectedBook.author}</p>
              {(selectedBook.category || selectedBook.pageCount) && (
                <p className={styles.modalMeta}>
                  {selectedBook.category && CATEGORY_LABELS[selectedBook.category]}
                  {selectedBook.category && selectedBook.pageCount ? ' · ' : ''}
                  {selectedBook.pageCount ? `${selectedBook.pageCount} pages` : ''}
                </p>
              )}
              <span className={`${styles.badge} ${selectedBook.status === 'read' ? styles.badgeRead : isReading(selectedBook) ? styles.badgeReading : styles.badgeUnread}`} style={{ position: 'static', width: 'fit-content' }}>
                {selectedBook.status === 'read' ? 'Lu' : isReading(selectedBook) ? 'En cours' : 'Non lu'}
              </span>
              {isReading(selectedBook) && (
                <div>
                  <div className={styles.modalProgressTrack}>
                    <div className={styles.modalProgressFill} style={{ width: `${selectedBook.readingProgress}%` }} />
                  </div>
                  <p className={styles.modalProgressLabel}>{selectedBook.readingProgress}% lu</p>
                </div>
              )}
              {selectedBook.rating > 0 && <Stars rating={selectedBook.rating} />}
              {selectedBook.description && <p className={styles.modalDescription}>{selectedBook.description}</p>}
              {selectedBook.notes && <p className={styles.modalNotes}>{selectedBook.notes}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
