import React, { useState, useEffect, useRef } from 'react';
import axiosAdmin from '../../axiosAdmin';
import { toast } from 'react-toastify';
import styles from './ReadingPage.module.css';
import GoogleBooksSearch from '../../components/GoogleBooksSearch';

const FILTERS = [
  { key: 'all',    label: 'Tous' },
  { key: 'unread', label: 'Non lus' },
  { key: 'read',   label: 'Lus' },
];

const BookPlaceholder = () => (
  <div className={styles.coverPlaceholder}>
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
    </svg>
  </div>
);

// Composant étoiles SVG
const StarRating = ({ rating = 0, bookId, onRate }) => {
  const [hovered, setHovered] = useState(0);

  return (
    <div className={styles.starRow} onMouseLeave={() => setHovered(0)}>
      {[1, 2, 3, 4, 5].map(star => {
        const active = star <= (hovered || rating);
        return (
          <button
            key={star}
            className={styles.starBtn}
            onMouseEnter={() => setHovered(star)}
            onClick={() => onRate(bookId, star === rating ? 0 : star)}
            title={`${star} étoile${star > 1 ? 's' : ''}`}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill={active ? '#f59e0b' : 'none'}
              stroke={active ? '#f59e0b' : 'rgba(255,255,255,0.4)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{}}>
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
          </button>
        );
      })}
    </div>
  );
};

export default function ReadingPage() {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [showSearch, setShowSearch] = useState(false);
  const [search, setSearch] = useState('');
  const filterBarRef = useRef(null);

  useEffect(() => { fetchBooks(); }, [filter]);

  const fetchBooks = async () => {
    try {
      setLoading(true);
      const res = await axiosAdmin.get(`/api/reading?status=${filter}`);
      setBooks(res.data);
    } catch {
      toast.error('Erreur lors du chargement de la liste');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectBook = async (book) => {
    const info = book.volumeInfo || book;
    const title = info.title || '';
    const author = (info.authors || []).join(', ') || '';
    const thumbnail = info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || '';
    try {
      await axiosAdmin.post('/api/reading', {
        title,
        author,
        thumbnail,
        googleBooksId: book.id || '',
      });
      toast.success(`"${title}" ajouté à votre liste`);
      setShowSearch(false);
      fetchBooks();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Erreur lors de l\'ajout');
    }
  };

  const toggleStatus = async (book) => {
    const newStatus = book.status === 'read' ? 'unread' : 'read';
    try {
      await axiosAdmin.put(`/api/reading/${book._id}`, { status: newStatus });
      setBooks(prev => prev.map(b =>
        b._id === book._id ? { ...b, status: newStatus } : b
      ));
    } catch {
      toast.error('Erreur lors de la mise à jour');
    }
  };

  const handleRate = async (bookId, rating) => {
    try {
      await axiosAdmin.put(`/api/reading/${bookId}`, { rating });
      setBooks(prev => prev.map(b => b._id === bookId ? { ...b, rating } : b));
    } catch {
      toast.error('Erreur lors de la notation');
    }
  };

  const handleDelete = async (id) => {
    try {
      await axiosAdmin.delete(`/api/reading/${id}`);
      setBooks(prev => prev.filter(b => b._id !== id));
      toast.success('Livre retiré de la liste');
    } catch {
      toast.error('Erreur lors de la suppression');
    }
  };

  const filtered = books.filter(b => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return b.title.toLowerCase().includes(s) || b.author.toLowerCase().includes(s);
  });

  const readCount = books.filter(b => b.status === 'read').length;
  const totalCount = books.length;
  const ratedBooks = books.filter(b => b.rating > 0);
  const avgRating = ratedBooks.length > 0
    ? (ratedBooks.reduce((sum, b) => sum + b.rating, 0) / ratedBooks.length).toFixed(1)
    : null;

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Ma bibliothèque</h1>

      {/* Stats */}
      {totalCount > 0 && (
        <div className={styles.stats}>
          <div className={styles.statItem}>
            <span className={styles.statNum}>{totalCount}</span>
            <span className={styles.statLabel}>livre{totalCount > 1 ? 's' : ''}</span>
          </div>
          <div className={styles.statDivider}/>
          <div className={styles.statItem}>
            <span className={styles.statNum}>{readCount}</span>
            <span className={styles.statLabel}>lu{readCount > 1 ? 's' : ''}</span>
          </div>
          <div className={styles.statDivider}/>
          <div className={styles.statItem}>
            <span className={styles.statNum}>{totalCount - readCount}</span>
            <span className={styles.statLabel}>non lu{totalCount - readCount > 1 ? 's' : ''}</span>
          </div>
          {avgRating && (
            <>
              <div className={styles.statDivider}/>
              <div className={styles.statItem}>
                <span className={styles.statNum} style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                  {avgRating}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" style={{ color: '#f59e0b' }}>
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                  </svg>
                </span>
                <span className={styles.statLabel}>note moy.</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Barre filtres + recherche + ajouter */}
      <div className={styles.toolbar}>
        <div className={styles.filterBarWrapper}>
          <div className={styles.filterBar} ref={filterBarRef}>
            {FILTERS.map(f => (
              <button
                key={f.key}
                className={`${styles.filterPill} ${filter === f.key ? styles.filterPillActive : ''}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.toolbarRight}>
          <div className={styles.searchWrap}>
            <span className={styles.searchIcon}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </span>
            <input
              className={styles.searchInput}
              placeholder="Filtrer..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <button className={styles.addBtn} onClick={() => setShowSearch(s => !s)} title="Ajouter un livre">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Recherche Google Books */}
      {showSearch && (
        <div className={styles.searchPanel}>
          <GoogleBooksSearch onSelectBook={handleSelectBook} />
        </div>
      )}

      {/* Liste */}
      {loading ? (
        <div className={styles.empty}>Chargement...</div>
      ) : filtered.length === 0 ? (
        <div className={styles.empty}>
          {search ? 'Aucun résultat pour cette recherche' : 'Aucun livre dans cette liste'}
        </div>
      ) : (
        <div className={styles.bookList}>
          {filtered.map(book => (
            <div key={book._id} className={`${styles.bookCard} ${book.status === 'read' ? styles.bookCardRead : ''}`}>
              {/* Cover */}
              {book.thumbnail
                ? <img src={book.thumbnail} alt={book.title} className={styles.cover} />
                : <BookPlaceholder />
              }

              {/* Info */}
              <div className={styles.bookInfo}>
                <div className={styles.bookTitle}>{book.title}</div>
                <div className={styles.bookAuthor}>{book.author}</div>
                <div className={styles.bookMeta}>
                  {book.source === 'request' && (
                    <span className={styles.sourceBadge}>Demande</span>
                  )}
                  <StarRating rating={book.rating || 0} bookId={book._id} onRate={handleRate} />
                </div>
              </div>

              {/* Actions */}
              <div className={styles.bookActions}>
                <button
                  className={`${styles.statusBtn} ${book.status === 'read' ? styles.statusBtnRead : styles.statusBtnUnread}`}
                  onClick={() => toggleStatus(book)}
                  title={book.status === 'read' ? 'Marquer comme non lu' : 'Marquer comme lu'}
                >
                  {book.status === 'read'
                    ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/></svg>
                  }
                  {book.status === 'read' ? 'Lu' : 'Non lu'}
                </button>

                <button
                  className={styles.deleteBtn}
                  onClick={() => handleDelete(book._id)}
                  title="Retirer de la liste"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
