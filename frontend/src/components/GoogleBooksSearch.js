import React, { useState, useRef } from 'react';
import axiosAdmin from '../axiosAdmin';
import styles from './GoogleBooksSearch.module.css';
import BarcodeScanner from './BarcodeScanner';

const PER_PAGE = 10;
const MIN_LEN  = 2;

const LoadingSpinner = () => (
  <div className={styles.loading}>
    <div className={styles.loadingSpinner}></div>
    <p>Recherche en cours...</p>
  </div>
);

const NoResults = ({ query }) => (
  <div className={styles.noResults}>
    <p>Aucun résultat trouvé pour "{query}"</p>
    <p>Essayez avec des termes de recherche différents.</p>
  </div>
);

const IconSearch = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
  </svg>
);

const IconCamera = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/>
    <circle cx="12" cy="13" r="3"/>
  </svg>
);

const IconAuthor = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
  </svg>
);

const GoogleBooksSearch = ({ onSelectBook }) => {
  const [authorMode, setAuthorMode]   = useState(false);
  const [value, setValue]             = useState('');
  const [scanning, setScanning]       = useState(false);

  const [searchedValue, setSearchedValue] = useState('');
  const [searchedAuthor, setSearchedAuthor] = useState(false);

  const [results, setResults]       = useState([]);
  const [totalItems, setTotalItems] = useState(0);
  const [page, setPage]             = useState(1);

  const [isLoading, setIsLoading]     = useState(false);
  const [error, setError]             = useState('');
  const [hasSearched, setHasSearched] = useState(false);

  const searchTimeoutRef = useRef(null);
  const inputRef         = useRef(null);
  const totalPages       = Math.ceil(totalItems / PER_PAGE);

  // ─── Recherche ────────────────────────────────────────────────────────────
  const searchBooks = async (val, isAuthor, pageNum = 1) => {
    const trimmed = val.trim();
    if (trimmed.length < MIN_LEN) { setResults([]); return; }

    setSearchedValue(trimmed);
    setSearchedAuthor(isAuthor);
    setHasSearched(true);
    setPage(pageNum);
    setIsLoading(true);
    setError('');

    try {
      const params = { maxResults: PER_PAGE, startIndex: (pageNum - 1) * PER_PAGE };
      if (isAuthor) {
        params.author = trimmed;
      } else {
        params.q        = trimmed;
        params.combined = 'true';
      }

      const response = await axiosAdmin.get('/api/books/search', { params });
      const data = response.data;
      setResults(Array.isArray(data) ? data : (data.results || []));
      setTotalItems(Array.isArray(data) ? 0 : (data.totalItems || 0));
    } catch (err) {
      console.error('Erreur lors de la recherche:', err);
      setError(err.response?.data?.message || 'Erreur lors de la recherche. Veuillez réessayer.');
      setResults([]);
      setTotalItems(0);
    } finally {
      setIsLoading(false);
    }
  };

  // ─── Toggle mode auteur ───────────────────────────────────────────────────
  const handleToggleAuthor = () => {
    const next = !authorMode;
    setAuthorMode(next);
    setValue('');
    setResults([]);
    setHasSearched(false);
    setTotalItems(0);
    setPage(1);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  // ─── Soumission ───────────────────────────────────────────────────────────
  const handleSubmit = (e) => {
    e.preventDefault();
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchBooks(value, authorMode, 1);
  };

  const handlePageChange = (newPage) => {
    searchBooks(searchedValue, searchedAuthor, newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ─── Saisie ───────────────────────────────────────────────────────────────
  const handleChange = (e) => {
    const v = e.target.value;
    setValue(v);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (v.trim().length >= MIN_LEN) {
      searchTimeoutRef.current = setTimeout(() => searchBooks(v, authorMode, 1), 500);
    }
  };

  // ─── Sélection d'un livre ─────────────────────────────────────────────────
  const handleSelectBook = (book) => {
    onSelectBook({
      volumeInfo: {
        title:         book.volumeInfo.title,
        authors:       book.volumeInfo.authors || [],
        publishedDate: book.volumeInfo.publishedDate || '',
        pageCount:     book.volumeInfo.pageCount,
        imageLinks:    book.volumeInfo.imageLinks || {},
        description:   book.volumeInfo.description || '',
        infoLink:      book.volumeInfo.infoLink || `https://books.google.fr/books?id=${book.id}`,
        categories:    book.volumeInfo.categories || [],
      },
      id: book.id,
    });
  };

  // ─── Scan code-barres ─────────────────────────────────────────────────────
  const handleBarcodeScan = (isbn) => {
    setScanning(false);
    setAuthorMode(false);
    setValue(isbn);
    searchBooks(isbn, false, 1);
  };

  const canSubmit     = !isLoading && value.trim().length >= MIN_LEN;
  const showNoResults = hasSearched && results.length === 0 && !isLoading;
  const placeholder   = authorMode
    ? 'Rechercher par auteur…'
    : 'Rechercher par titre, ISBN ou auteur…';

  return (
    <div className={styles.googleBooksSearch}>
      <form onSubmit={handleSubmit} className={styles.searchForm}>
        <div className={styles.searchBar}>

          {/* Toggle auteur */}
          <button
            type="button"
            className={`${styles.authorToggle} ${authorMode ? styles.authorToggleActive : ''}`}
            onClick={handleToggleAuthor}
            title={authorMode ? 'Mode auteur actif — cliquer pour désactiver' : 'Activer la recherche par auteur'}
            aria-pressed={authorMode}
          >
            <IconAuthor size={15} />
          </button>

          {/* Champ unique */}
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={handleChange}
            placeholder={placeholder}
            className={styles.searchInputInline}
            autoComplete="off"
          />

          {/* Bouton scanner */}
          <button
            type="button"
            className={styles.scanBtn}
            onClick={() => setScanning(true)}
            aria-label="Scanner un code-barres"
            title="Scanner le code-barres d'un livre"
          >
            <IconCamera size={16} />
          </button>

          {/* Bouton recherche */}
          <button type="submit" className={styles.searchBtn} disabled={!canSubmit} aria-label="Rechercher">
            {isLoading ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={styles.spinIcon}>
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
            ) : (
              <IconSearch size={18} />
            )}
          </button>

        </div>
      </form>

      {scanning && (
        <BarcodeScanner
          onDetected={handleBarcodeScan}
          onClose={() => setScanning(false)}
        />
      )}

      <div className={styles.resultsContainer}>
        {isLoading ? (
          <LoadingSpinner />
        ) : results.length > 0 ? (
          <>
            <div className={styles.booksGrid}>
              {results.map((book) => (
                <div key={book.id} className={styles.bookCard} onClick={() => handleSelectBook(book)}>
                  <div className={styles.bookCover}>
                    {book.volumeInfo.imageLinks?.thumbnail ? (
                      <img src={book.volumeInfo.imageLinks.thumbnail} alt={book.volumeInfo.title} />
                    ) : (
                      <div className={styles.noCover}>📚<br /><span>Pas de couverture</span></div>
                    )}
                  </div>
                  <div className={styles.bookInfo}>
                    <h4>{book.volumeInfo.title}</h4>
                    {book.volumeInfo.authors && (
                      <p className={styles.bookAuthor}>{book.volumeInfo.authors.join(', ')}</p>
                    )}
                    {(book.volumeInfo.publishedDate || book.volumeInfo.pageCount) && (
                      <p className={styles.bookMeta}>
                        {book.volumeInfo.publishedDate && new Date(book.volumeInfo.publishedDate).getFullYear()}
                        {book.volumeInfo.pageCount && ` · ${book.volumeInfo.pageCount} p.`}
                      </p>
                    )}
                  </div>
                  <div className={styles.bookChevron}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m9 18 6-6-6-6"/>
                    </svg>
                  </div>
                </div>
              ))}
            </div>
            {totalPages > 1 && (
              <div className={styles.pagination}>
                <button className={styles.pageBtn} disabled={page <= 1} onClick={() => handlePageChange(page - 1)}>← Précédent</button>
                <span className={styles.pageInfo}>Page {page} / {totalPages}</span>
                <button className={styles.pageBtn} disabled={page >= totalPages} onClick={() => handlePageChange(page + 1)}>Suivant →</button>
              </div>
            )}
          </>
        ) : showNoResults ? (
          <NoResults query={searchedValue} />
        ) : null}
      </div>
    </div>
  );
};

export default GoogleBooksSearch;
