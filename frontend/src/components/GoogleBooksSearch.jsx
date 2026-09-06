import React, { useState, useRef, useLayoutEffect, useEffect } from 'react';
import axiosAdmin from '../axiosAdmin';
import styles from './GoogleBooksSearch.module.css';
import BarcodeScanner from './BarcodeScanner';
import { GoogleIcon } from './admin/brandIcons';
import hardcoverLogo from '../assets/icons/hardcover.png';
import openLibraryLogo from '../assets/icons/open-library.png';

const PER_PAGE = 10;
const MIN_LEN  = 2;

const LoadingSpinner = () => (
  <div className={styles.loading}>
    <div className={styles.loadingSpinner}></div>
    <p>Recherche en cours...</p>
  </div>
);

const NoResults = ({ query, onSwitchToManual }) => (
  <div className={styles.noResults}>
    <p>Aucun résultat trouvé pour "{query}"</p>
    <p>Essayez avec des termes de recherche différents.</p>
    {onSwitchToManual && (
      <p className={styles.noResultsManual}>
        Toujours rien ?{' '}
        <button type="button" className={styles.noResultsManualBtn} onClick={onSwitchToManual}>
          Ajoutez le livre manuellement
        </button>.
      </p>
    )}
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

const IconSeries = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
    <line x1="8" y1="7" x2="16" y2="7"/>
    <line x1="8" y1="11" x2="12" y2="11"/>
  </svg>
);

const IconTitle = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
  </svg>
);

const MODE_ICONS = {
  global: <IconTitle  size={14} />,
  title:  <IconTitle  size={14} />,
  author: <IconAuthor size={14} />,
  series: <IconSeries size={14} />,
};

const SEARCH_MODES = [
  { value: 'global', label: 'Recherche globale' },
  { value: 'title',  label: 'Titre'  },
  { value: 'author', label: 'Auteur' },
  { value: 'series', label: 'Série'  },
];

const PLACEHOLDERS = {
  global: 'Titre, auteur + titre ou ISBN…',
  title:  'Titre exact (recherche stricte)…',
  author: 'Rechercher par auteur…',
  series: 'Nom de la série…',
};

const GoogleBooksSearch = ({ onSelectBook, onBatchSelectBooks, batchSubmitting = false, batchProgress = null, onSwitchToManual }) => {
  const [searchMode, setSearchMode]   = useState('global');
  const [value, setValue]             = useState('');
  const [scanning, setScanning]       = useState(false);
  const [selectedBooks, setSelectedBooks] = useState(new Map()); // id → book

  const [searchedValue, setSearchedValue] = useState('');
  const [searchedMode, setSearchedMode]   = useState('global');

  const [results, setResults]       = useState([]);
  const [totalItems, setTotalItems] = useState(0);
  const [page, setPage]             = useState(1);

  const [isLoading, setIsLoading]     = useState(false);
  const [error, setError]             = useState('');
  const [hasSearched, setHasSearched] = useState(false);

  const [focused, setFocused]                 = useState(false);
  const [placeholderScrolls, setPlaceholderScrolls] = useState(false);

  const searchTimeoutRef    = useRef(null);
  const inputRef            = useRef(null);
  const inputWrapRef        = useRef(null);
  const fakePlaceholderRef  = useRef(null);
  const totalPages          = Math.ceil(totalItems / PER_PAGE);
  const placeholder         = PLACEHOLDERS[searchMode];

  // ─── Détection du débordement du placeholder ─────────────────────────────
  useLayoutEffect(() => {
    const check = () => {
      const text = fakePlaceholderRef.current;
      if (!text) return;
      const textW = text.offsetWidth;
      const boxW  = text.parentElement?.clientWidth ?? 0;
      const overflow = textW - boxW;
      if (overflow > 2) {
        setPlaceholderScrolls(true);
        text.style.setProperty('--scroll-amount', `-${overflow + 6}px`);
      } else {
        setPlaceholderScrolls(false);
      }
    };
    check();
    const ro = new ResizeObserver(check);
    if (inputWrapRef.current) ro.observe(inputWrapRef.current);
    return () => ro.disconnect();
  }, [placeholder]);

  // ─── Recherche ────────────────────────────────────────────────────────────
  const searchBooks = async (val, mode, pageNum = 1) => {
    const trimmed = val.trim();
    if (trimmed.length < MIN_LEN) { setResults([]); return; }

    setSearchedValue(trimmed);
    setSearchedMode(mode);
    setHasSearched(true);
    setPage(pageNum);
    setIsLoading(true);
    setError('');

    try {
      let items = [];
      let total = 0;

      if (mode === 'series') {
        const response = await axiosAdmin.get('/api/books/series-tomes', { params: { name: trimmed } });
        items = response.data.results || [];
        total = items.length;
      } else {
        const params = { maxResults: PER_PAGE, startIndex: (pageNum - 1) * PER_PAGE };
        if (mode === 'author') {
          params.author = trimmed;
        } else if (mode === 'title') {
          // Recherche titre STRICT (patch) : limite Google Books au champ
          // titre (intitle:), contrairement au mode "global" qui accepte
          // aussi une recherche libre melangeant auteur et titre.
          params.q = trimmed;
          params.strictTitle = 'true';
        } else {
          // mode === 'global'
          params.q        = trimmed;
          params.combined = 'true';
        }
        const response = await axiosAdmin.get('/api/books/search', { params });
        const data = response.data;
        items = Array.isArray(data) ? data : (data.results || []);
        total = Array.isArray(data) ? 0 : (data.totalItems || 0);
      }

      setResults(items);
      setTotalItems(total);
    } catch (err) {
      console.error('Erreur lors de la recherche:', err);
      setError(err.response?.data?.message || 'Erreur lors de la recherche. Veuillez réessayer.');
      setResults([]);
      setTotalItems(0);
    } finally {
      setIsLoading(false);
    }
  };

  // ─── Changement de mode ───────────────────────────────────────────────────
  // (patch) : ne vide plus le champ tapé — harmonisation avec la recherche
  // directe, qui préserve déjà le texte en changeant de mode (demande de Gus).
  const handleModeChange = (newMode) => {
    if (newMode === searchMode) return;
    setSearchMode(newMode);
    setResults([]);
    setHasSearched(false);
    setTotalItems(0);
    setPage(1);
    setSelectedBooks(new Map());
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  // ─── Soumission ───────────────────────────────────────────────────────────
  const handleSubmit = (e) => {
    e.preventDefault();
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    setSelectedBooks(new Map());
    searchBooks(value, searchMode, 1);
  };

  const handlePageChange = (newPage) => {
    searchBooks(searchedValue, searchedMode, newPage);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ─── Saisie ───────────────────────────────────────────────────────────────
  const handleChange = (e) => {
    const v = e.target.value;
    setValue(v);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (v.trim().length >= MIN_LEN) {
      searchTimeoutRef.current = setTimeout(() => { setSelectedBooks(new Map()); searchBooks(v, searchMode, 1); }, 500);
    } else if (v.trim().length === 0) {
      setResults([]);
      setTotalItems(0);
      setHasSearched(false);
      setPage(1);
    }
  };

  // Vider la sélection quand l'envoi batch se termine
  useEffect(() => {
    if (!batchSubmitting && selectedBooks.size > 0) {
      setSelectedBooks(new Map());
    }
  }, [batchSubmitting]);

  // ─── Sélection batch ──────────────────────────────────────────────────────
  const toggleSelect = (e, book) => {
    e.stopPropagation();
    setSelectedBooks(prev => {
      const next = new Map(prev);
      next.has(book.id) ? next.delete(book.id) : next.set(book.id, book);
      return next;
    });
  };

  const handleBatchRequest = () => {
    if (!onBatchSelectBooks) return;
    onBatchSelectBooks([...selectedBooks.values()]);
  };

  // ─── Sélection d'un livre ─────────────────────────────────────────────────
  const handleSelectBook = (book) => {
    onSelectBook(
      {
        volumeInfo: {
          title:         book.volumeInfo.title,
          authors:       book.volumeInfo.authors || [],
          publishedDate: book.volumeInfo.publishedDate || '',
          pageCount:     book.volumeInfo.pageCount,
          imageLinks:    book.volumeInfo.imageLinks || {},
          description:   book.volumeInfo.description || '',
          infoLink:      book.volumeInfo.infoLink || `https://books.google.fr/books?id=${book.id}`,
          categories:    book.volumeInfo.categories || [],
          seriesInfo:    book.volumeInfo.seriesInfo  || null,
        },
        id: book.id,
      },
      { searchMode, searchedValue }
    );
  };

  // ─── Scan code-barres ─────────────────────────────────────────────────────
  const handleBarcodeScan = (isbn) => {
    setScanning(false);
    setSearchMode('global');
    setValue(isbn);
    searchBooks(isbn, 'global', 1);
  };

  const canSubmit     = !isLoading && value.trim().length >= MIN_LEN;
  const showNoResults = hasSearched && results.length === 0 && !isLoading;

  return (
    <div className={styles.googleBooksSearch}>
      <form onSubmit={handleSubmit} className={styles.searchForm}>

        {/* Sélecteur de mode — mêmes boutons que la recherche directe */}
        <div className={styles.modeToggle}>
          {SEARCH_MODES.map(m => (
            <button
              key={m.value}
              type="button"
              className={`${styles.modeBtn} ${searchMode === m.value ? styles.modeBtnActive : ''}`}
              onClick={() => handleModeChange(m.value)}
            >
              {MODE_ICONS[m.value]}
              {m.label}
            </button>
          ))}
        </div>

        <div className={styles.searchBar}>

          {/* Champ unique */}
          <div className={styles.inputWrap} ref={inputWrapRef}>
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={handleChange}
              className={styles.searchInputInline}
              autoComplete="off"
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
            />
            <span
              className={`${styles.fakePlaceholder} ${(value || focused) ? styles.fakePlaceholderHidden : ''}`}
              aria-hidden="true"
            >
              <span
                ref={fakePlaceholderRef}
                className={`${styles.fakePlaceholderText} ${placeholderScrolls ? styles.fakePlaceholderScrolling : ''}`}
              >
                {placeholder}
              </span>
            </span>
          </div>

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
            {onBatchSelectBooks && selectedBooks.size === 0 && (
              <p className={styles.batchHint}>Cliquez sur les couvertures pour sélectionner plusieurs livres à demander en une fois</p>
            )}
            {onBatchSelectBooks && selectedBooks.size > 0 && (
              <div className={styles.batchBar}>
                {batchSubmitting && batchProgress ? (
                  <>
                    <svg className={styles.spinIcon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                    </svg>
                    <span className={styles.batchCount}>
                      Envoi en cours… {batchProgress.current}/{batchProgress.total}
                    </span>
                    <div className={styles.batchProgressBar}>
                      <div
                        className={styles.batchProgressFill}
                        style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <span className={styles.batchCount}>{selectedBooks.size} livre{selectedBooks.size > 1 ? 's' : ''} sélectionné{selectedBooks.size > 1 ? 's' : ''}</span>
                    <button className={styles.batchBtn} onClick={handleBatchRequest} disabled={batchSubmitting}>
                      {batchSubmitting ? (
                        <>
                          <svg className={styles.spinIcon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                          </svg>
                          Envoi en cours…
                        </>
                      ) : `Demander les ${selectedBooks.size} livres`}
                    </button>
                    {!batchSubmitting && (
                      <button className={styles.batchClear} onClick={() => setSelectedBooks(new Map())}>Tout désélectionner</button>
                    )}
                  </>
                )}
              </div>
            )}
            <div className={styles.booksGrid}>
              {results.map((book) => {
                const isSelected = selectedBooks.has(book.id);
                return (
                  <div
                    key={book.id}
                    className={`${styles.bookCard} ${isSelected ? styles.bookCardSelected : ''}`}
                    onClick={() => handleSelectBook(book)}
                  >
                    <div className={styles.bookCover}>
                      {book.volumeInfo.imageLinks?.thumbnail ? (
                        <img src={book.volumeInfo.imageLinks.thumbnail} alt={book.volumeInfo.title} />
                      ) : (
                        <div className={styles.noCover}>📚<br /><span>Pas de couverture</span></div>
                      )}
                      {onBatchSelectBooks && (
                        <div
                          className={`${styles.selectCircle} ${isSelected ? styles.selectCircleActive : ''}`}
                          onClick={e => toggleSelect(e, book)}
                          title={isSelected ? 'Désélectionner' : 'Sélectionner'}
                        >
                          {isSelected && (
                            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="2,6 5,9 10,3"/>
                            </svg>
                          )}
                        </div>
                      )}
                    </div>
                    <div className={styles.bookInfo}>
                      <div className={styles.bookTitleRow}>
                        <h4>{book.volumeInfo.title}</h4>
                        {book.id?.startsWith('ol-') && (
                          <span className={styles.googleBadge} title="Résultat Open Library — le lien de la demande pointera vers openlibrary.org">
                            <img src={openLibraryLogo} alt="" className={styles.hcBadgeIcon} />
                          </span>
                        )}
                        {book.id?.startsWith('hc-') && (
                          <span className={styles.googleBadge} title="Résultat Hardcover — le lien de la demande pointera vers hardcover.app">
                            <img src={hardcoverLogo} alt="" className={styles.hcBadgeIcon} />
                          </span>
                        )}
                        {!book.id?.startsWith('ol-') && !book.id?.startsWith('hc-') && (
                          <span className={styles.googleBadge} title="Résultat Google Books">
                            <GoogleIcon size={12} />
                          </span>
                        )}
                      </div>
                      {book.volumeInfo.authors && (
                        <p className={styles.bookAuthor}>{book.volumeInfo.authors.join(', ')}</p>
                      )}
                      {(book.volumeInfo.publishedDate || book.volumeInfo.pageCount || book.volumeInfo.communityRating) && (
                        <p className={styles.bookMeta}>
                          {book.volumeInfo.publishedDate && new Date(book.volumeInfo.publishedDate).getFullYear()}
                          {book.volumeInfo.pageCount && ` · ${book.volumeInfo.pageCount} p.`}
                          {book.volumeInfo.communityRating && (
                            <span className={styles.communityRating} title={book.volumeInfo.communityRatingsCount ? `${book.volumeInfo.communityRatingsCount} notes Hardcover` : 'Note Hardcover'}>
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                              {Number(book.volumeInfo.communityRating).toFixed(1)}
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                    <div className={styles.bookChevron}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m9 18 6-6-6-6"/>
                      </svg>
                    </div>
                  </div>
                );
              })}
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
          <NoResults query={searchedValue} onSwitchToManual={onSwitchToManual} />
        ) : null}
      </div>
    </div>
  );
};

export default GoogleBooksSearch;
