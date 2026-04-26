import React, { useState, useEffect,useRef } from 'react';
import axiosAdmin from '../axiosAdmin';
import styles from './GoogleBooksSearch.module.css';

// Loader
const LoadingSpinner = () => (
  <div className={styles.loading}>
    <div className={styles.loadingSpinner}></div>
    <p>Recherche en cours...</p>
  </div>
);

// Composant pour afficher qu'il n'y a pas de résultats
const NoResults = ({ query }) => (
  <div className={styles.noResults}>
    <p>Aucun résultat trouvé pour "{query}"</p>
    <p>Essayez avec des termes de recherche différents.</p>
  </div>
);

const GoogleBooksSearch = ({ onSelectBook }) => {
  const [query, setQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const searchTimeoutRef = useRef(null);
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);

  // Fonction pour effectuer la recherche
  const searchBooks = async (searchTerm, isAutoSuggest = false) => {
    if (!searchTerm.trim()) {
      if (!isAutoSuggest) setResults([]);
      return;
    }
    
    if (!isAutoSuggest) {
      setSearchQuery(searchTerm);
      setHasSearched(true);
      setShowSuggestions(false);
    }
    
    setIsLoading(true);
    setError('');
    
    try {
      const response = await axiosAdmin.get('/api/books/search', {
        params: {
          q: searchTerm,
          maxResults: isAutoSuggest ? 4 : 4
        }
      });
      
      if (isAutoSuggest) {
        setSuggestions(response.data || []);
      } else {
        setResults(response.data || []);
      }
    } catch (err) {
      console.error('Erreur lors de la recherche de livres:', err);
      setError(err.response?.data?.message || 'Erreur lors de la recherche. Veuillez réessayer.');
      if (!isAutoSuggest) setResults([]);
      setSuggestions([]);
    } finally {
      setIsLoading(false);
    }
  };
  
  // Gestionnaire de soumission du formulaire
  const handleSubmit = (e) => {
    e.preventDefault();
    searchBooks(query.trim(), false);
  };
  
  // Gestionnaire de saisie avec debounce
  const handleInputChange = (e) => {
    const value = e.target.value;
    setQuery(value);
    
    // Réinitialiser le timeout précédent
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    
    if (value.trim().length > 2) {
      setIsTyping(true);
      setShowSuggestions(true);
      
      // Définir un nouveau timeout
      searchTimeoutRef.current = setTimeout(() => {
        searchBooks(value.trim(), true);
        setIsTyping(false);
      }, 500); // Délai de 500ms
    } else {
      setShowSuggestions(false);
      setSuggestions([]);
    }
  };

  const handleSelectBook = (book) => {
    const bookInfo = {
      volumeInfo: {
        title: book.volumeInfo.title,
        authors: book.volumeInfo.authors || [],
        publishedDate: book.volumeInfo.publishedDate || '',
        pageCount: book.volumeInfo.pageCount,
        imageLinks: book.volumeInfo.imageLinks || {},
        description: book.volumeInfo.description || '',
        infoLink: book.volumeInfo.infoLink || `https://books.google.fr/books?id=${book.id}`,
        categories: book.volumeInfo.categories || []
      },
      id: book.id
    };
    
    onSelectBook(bookInfo);
    setResults([]);
    setQuery('');
  };

  // Gestion du clic en dehors du dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target) && 
          inputRef.current && !inputRef.current.contains(event.target)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Sélection d'une suggestion
  const handleSuggestionClick = (book) => {
    handleSelectBook(book);
    setShowSuggestions(false);
  };

  // Afficher les suggestions ou les résultats de recherche
  const displayResults = showSuggestions ? suggestions : results;
  const showResults = (showSuggestions && suggestions.length > 0) || results.length > 0 || hasSearched;
  const showNoResults = hasSearched && results.length === 0 && !isLoading && !showSuggestions;
  const showInitialState = !hasSearched && !showSuggestions && !isLoading;

  return (
    <div className={styles.googleBooksSearch}>
      <form onSubmit={handleSubmit} className={styles.searchForm}>
        <div className={styles.searchInputContainer}>
          <div className={styles.inputWrapper}>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={handleInputChange}
              onFocus={() => query.length > 2 && setShowSuggestions(true)}
              placeholder="Rechercher un livre par titre, auteur ou ISBN..."
              className={styles.searchInput}
              aria-label="Rechercher un livre"
              autoComplete="off"
            />
          </div>
          <div className={styles.buttonWrapper}>
            <button
              type="submit"
              className={styles.searchButton}
              disabled={isLoading || query.trim().length < 3}
              aria-label="Rechercher"
            >
              {isLoading ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={styles.spinIcon}>
                  <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                </svg>
              )}
            </button>
          </div>
        </div>
      </form>

      <div className={styles.resultsContainer}>
        {isLoading ? (
          <LoadingSpinner />
        ) : showResults ? (
          <div className={styles.booksGrid}>
            {displayResults.map((book) => (
              <div 
                key={book.id} 
                className={styles.bookCard}
                onClick={() => handleSelectBook(book)}
              >
                <div className={styles.bookCover}>
                  {book.volumeInfo.imageLinks?.thumbnail ? (
                    <img 
                      src={book.volumeInfo.imageLinks.thumbnail} 
                      alt={book.volumeInfo.title}
                    />
                  ) : (
                    <div className={styles.noCover}>
                      📚<br />
                      <span>Pas de couverture</span>
                    </div>
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
        ) : showNoResults ? (
          <NoResults query={query} />
        ) : null}
      </div>
    </div>
  );
};

export default GoogleBooksSearch;