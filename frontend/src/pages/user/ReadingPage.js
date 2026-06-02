import React, { useState, useEffect, useRef } from 'react';
import axiosAdmin from '../../axiosAdmin';
import { toast } from 'react-toastify';
import styles from './ReadingPage.module.css';
import GoogleBooksSearch from '../../components/GoogleBooksSearch';
import BookReaderModal from '../../components/BookReaderModal';

const READABLE_EXTS = ['pdf', 'epub', 'cbz', 'cbr'];
function isReadable(filePath) {
  if (!filePath) return false;
  const ext = filePath.split(/[\\/]/).pop().split('.').pop().toLowerCase();
  return READABLE_EXTS.includes(ext);
}

const FILTERS = [
  { key: 'all',     label: 'Tous' },
  { key: 'unread',  label: 'Non lus' },
  { key: 'read',    label: 'Lus' },
  { key: 'request', label: 'Demandes' },
  { key: 'manual',  label: 'Ajouts' },
];

const SORTS = [
  { key: 'date',   label: 'Date' },
  { key: 'title',  label: 'Titre' },
  { key: 'author', label: 'Auteur' },
  { key: 'rating', label: 'Note' },
];

const BookPlaceholder = () => (
  <div className={styles.coverPlaceholder}>
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
    </svg>
  </div>
);

const StarRating = ({ rating = 0, bookId, onRate }) => {
  const [hovered, setHovered] = useState(0);
  return (
    <div className={styles.starRow} onMouseLeave={() => setHovered(0)}>
      {[1, 2, 3, 4, 5].map(star => {
        const active = star <= (hovered || rating);
        return (
          <button key={star} className={styles.starBtn}
            onMouseEnter={() => setHovered(star)}
            onClick={() => onRate(bookId, star === rating ? 0 : star)}
            title={`${star} étoile${star > 1 ? 's' : ''}`}
          >
            <svg width="15" height="15" viewBox="0 0 24 24"
              fill={active ? '#f59e0b' : 'none'}
              stroke={active ? '#f59e0b' : 'rgba(255,255,255,0.4)'}
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
            </svg>
          </button>
        );
      })}
    </div>
  );
};

export default function ReadingPage() {
  const [books, setBooks]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [filter, setFilter]         = useState('all');
  const [sortBy, setSortBy]         = useState('date');
  const [sortDir, setSortDir]       = useState('desc');
  const [showSearch, setShowSearch] = useState(false);
  const [search, setSearch]         = useState('');
  const [downloading, setDownloading] = useState(null);
  const [addError, setAddError]     = useState('');
  const [readerBook, setReaderBook] = useState(null);
  const [editingNote, setEditingNote] = useState(null); // { id, text }
  const filterBarRef = useRef(null);

  // Auto-vider le message d'erreur après 5s
  useEffect(() => {
    if (!addError) return;
    const t = setTimeout(() => setAddError(''), 5000);
    return () => clearTimeout(t);
  }, [addError]);

  // Fetch toujours tout, filtrage client-side
  useEffect(() => { fetchBooks(); }, []); // eslint-disable-line

  const fetchBooks = async () => {
    try {
      setLoading(true);
      const res = await axiosAdmin.get('/api/reading?status=all');
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
    setAddError('');
    try {
      await axiosAdmin.post('/api/reading', { title, author, thumbnail, googleBooksId: book.id || '' });
      toast.success(`"${title}" ajouté à votre liste`);
      setShowSearch(false);
      fetchBooks();
    } catch (err) {
      const msg = err.response?.data?.message || 'Erreur lors de l\'ajout';
      if (err.response?.status === 409) setAddError(msg);
      else toast.error(msg);
    }
  };

  const toggleStatus = async (book) => {
    const newStatus = book.status === 'read' ? 'unread' : 'read';
    try {
      await axiosAdmin.put(`/api/reading/${book._id}`, { status: newStatus });
      setBooks(prev => prev.map(b => b._id === book._id ? { ...b, status: newStatus } : b));
    } catch { toast.error('Erreur lors de la mise à jour'); }
  };

  const handleRate = async (bookId, rating) => {
    try {
      await axiosAdmin.put(`/api/reading/${bookId}`, { rating });
      setBooks(prev => prev.map(b => b._id === bookId ? { ...b, rating } : b));
    } catch { toast.error('Erreur lors de la notation'); }
  };

  const handleSaveNote = async () => {
    if (!editingNote) return;
    const { id, text } = editingNote;
    try {
      await axiosAdmin.put(`/api/reading/${id}`, { notes: text });
      setBooks(prev => prev.map(b => b._id === id ? { ...b, notes: text } : b));
    } catch { toast.error('Erreur lors de la sauvegarde de la note'); }
    setEditingNote(null);
  };

  const downloadBook = async (book) => {
    if (downloading === book._id) return;
    const req = book.requestId;
    if (!req) return;
    setDownloading(book._id);
    try {
      if (req.downloadLink) { window.open(req.downloadLink, '_blank', 'noopener,noreferrer'); return; }
      if (req.filePath) {
        const response = await axiosAdmin.get(`/api/requests/download/${req._id}`, { responseType: 'blob' });
        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url;
        const disposition = response.headers['content-disposition'] || '';
        const match = disposition.match(/filename\*?=['"]?(?:UTF-8'')?([^;\n"']*)['"]?/i);
        link.setAttribute('download', match?.[1]?.trim() || `ebook_${req._id}`);
        document.body.appendChild(link); link.click(); link.remove();
        window.URL.revokeObjectURL(url);
      } else { toast.error('Aucun fichier disponible pour ce livre'); }
    } catch { toast.error('Erreur lors du téléchargement'); }
    finally { setDownloading(null); }
  };

  const handleDelete = async (id) => {
    try {
      await axiosAdmin.delete(`/api/reading/${id}`);
      setBooks(prev => prev.filter(b => b._id !== id));
      toast.success('Livre retiré de la liste');
    } catch { toast.error('Erreur lors de la suppression'); }
  };

  const toggleSort = (key) => {
    if (sortBy === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(key); setSortDir(key === 'date' ? 'desc' : 'asc'); }
  };

  // Filtrage + tri client-side
  const filtered = books
    .filter(b => {
      if (filter === 'read')    return b.status === 'read';
      if (filter === 'unread')  return b.status === 'unread';
      if (filter === 'request') return b.source === 'request';
      if (filter === 'manual')  return b.source === 'manual';
      return true;
    })
    .filter(b => {
      if (!search.trim()) return true;
      const s = search.toLowerCase();
      return b.title.toLowerCase().includes(s) || b.author.toLowerCase().includes(s);
    })
    .sort((a, b) => {
      let va, vb;
      if (sortBy === 'title')  { va = a.title.toLowerCase();  vb = b.title.toLowerCase(); }
      else if (sortBy === 'author') { va = a.author.toLowerCase(); vb = b.author.toLowerCase(); }
      else if (sortBy === 'rating') { va = a.rating || 0; vb = b.rating || 0; }
      else { va = new Date(a.createdAt); vb = new Date(b.createdAt); }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ?  1 : -1;
      return 0;
    });

  const readCount  = books.filter(b => b.status === 'read').length;
  const totalCount = books.length;
  const ratedBooks = books.filter(b => b.rating > 0);
  const avgRating  = ratedBooks.length > 0
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

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.filterBarWrapper}>
          <div className={styles.filterBar} ref={filterBarRef}>
            {FILTERS.map(f => (
              <button key={f.key}
                className={`${styles.filterPill} ${filter === f.key ? styles.filterPillActive : ''}`}
                onClick={() => setFilter(f.key)}
              >{f.label}</button>
            ))}
          </div>
        </div>

        <div className={styles.toolbarRight}>
          {/* Tri */}
          <div className={styles.sortBar}>
            {SORTS.map(s => (
              <button key={s.key}
                className={`${styles.sortBtn} ${sortBy === s.key ? styles.sortBtnActive : ''}`}
                onClick={() => toggleSort(s.key)}
                title={sortBy === s.key ? (sortDir === 'asc' ? 'Croissant' : 'Décroissant') : s.label}
              >
                {s.label}
                {sortBy === s.key && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    {sortDir === 'asc'
                      ? <polyline points="18 15 12 9 6 15"/>
                      : <polyline points="6 9 12 15 18 9"/>}
                  </svg>
                )}
              </button>
            ))}
          </div>

          <div className={styles.searchWrap}>
            <span className={styles.searchIcon}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </span>
            <input className={styles.searchInput} placeholder="Filtrer..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          <button className={styles.addBtn} onClick={() => { setShowSearch(s => !s); setAddError(''); }} title="Ajouter un livre">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Recherche Google Books */}
      {showSearch && (
        <div className={styles.searchPanel}>
          {addError && (
            <div className={styles.addErrorMsg}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {addError}
            </div>
          )}
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
                  {book.source === 'request'
                    ? <span className={styles.sourceBadge}>Demande</span>
                    : <span className={`${styles.sourceBadge} ${styles.sourceBadgeManual}`}>Manuel</span>
                  }
                  <StarRating rating={book.rating || 0} bookId={book._id} onRate={handleRate} />
                </div>
                {/* Note preview */}
                {book.notes && editingNote?.id !== book._id && (
                  <div className={styles.notesPreview} onClick={() => setEditingNote({ id: book._id, text: book.notes })}>
                    {book.notes}
                  </div>
                )}
                {/* Note edit */}
                {editingNote?.id === book._id && (
                  <textarea
                    className={styles.notesInput}
                    value={editingNote.text}
                    placeholder="Ajouter une note..."
                    onChange={e => setEditingNote(prev => ({ ...prev, text: e.target.value }))}
                    onBlur={handleSaveNote}
                    autoFocus
                    rows={2}
                  />
                )}
              </div>

              {/* Actions */}
              <div className={styles.bookActions}>
                {/* Note */}
                <button
                  className={`${styles.noteBtn} ${book.notes ? styles.noteBtnActive : ''}`}
                  onClick={() => setEditingNote(editingNote?.id === book._id ? null : { id: book._id, text: book.notes || '' })}
                  title={book.notes ? 'Modifier la note' : 'Ajouter une note'}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>

                {/* Lire */}
                {book.source === 'request' && book.requestId && isReadable(book.requestId.filePath) && (
                  <button className={styles.readBtn} onClick={() => setReaderBook(book)} title="Lire">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
                      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
                    </svg>
                  </button>
                )}

                {/* Télécharger */}
                {book.source === 'request' && book.requestId && (book.requestId.downloadLink || book.requestId.filePath) && (
                  <button
                    className={`${styles.downloadBtn} ${downloading === book._id ? styles.downloadBtnBusy : ''}`}
                    onClick={() => downloadBook(book)} disabled={downloading === book._id} title="Télécharger"
                  >
                    {downloading === book._id ? <span className={styles.spinner} /> : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                      </svg>
                    )}
                  </button>
                )}

                {/* Statut */}
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

                {/* Supprimer */}
                <button className={styles.deleteBtn} onClick={() => handleDelete(book._id)} title="Retirer de la liste">
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

      {readerBook && (
        <BookReaderModal
          book={readerBook}
          onClose={() => setReaderBook(null)}
          onPositionSaved={(loc) =>
            setBooks(prev => prev.map(b => b._id === readerBook._id ? { ...b, epubLocation: loc } : b))
          }
        />
      )}
    </div>
  );
}
