import React, { useState, useCallback, useEffect, useRef } from 'react';
import axiosAdmin from '../../axiosAdmin';
import styles from './AuthorsPage.module.css';

const MIN_LEN = 2;
const BOOKS_PER_PAGE = 10;

// Palette fixe (même esprit que getAvatarColor pour les utilisateurs) :
// couleur dérivée du nom pour que le même auteur garde toujours la même
// couleur par défaut, plutôt qu'une icône générique identique pour tous.
const DEFAULT_PHOTO_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#ef4444', '#3b82f6'];

function hashNameToColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return DEFAULT_PHOTO_COLORS[Math.abs(hash) % DEFAULT_PHOTO_COLORS.length];
}

const AuthorPlaceholder = ({ name }) => (
  <div className={styles.photoPlaceholder} style={{ background: hashNameToColor(name || '?') }}>
    {(name || '?').trim().charAt(0).toUpperCase()}
  </div>
);

function AuthorPhoto({ src, alt }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <AuthorPlaceholder name={alt} />;
  return (
    <img
      src={src}
      alt={alt}
      className={styles.photo}
      onError={() => setFailed(true)}
      // Open Library renvoie un HTTP 200 avec un GIF transparent de quelques
      // pixels (pas une 404) quand l'auteur n'a pas de photo — onError ne se
      // déclenche jamais dans ce cas. Détecté via la taille réelle chargée.
      onLoad={e => { if (e.target.naturalWidth <= 2) setFailed(true); }}
    />
  );
}

const BookCoverPlaceholder = () => (
  <div className={styles.workCoverPlaceholder}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  </div>
);

export default function AuthorsPage() {
  const [followed, setFollowed] = useState([]);
  const [config, setConfig] = useState({ enabled: true, maxAuthorsPerUser: 50 });
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState(null);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [busyKey, setBusyKey] = useState(null);
  const [recentReleases, setRecentReleases] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsExpanded, setSuggestionsExpanded] = useState(() => localStorage.getItem('ebookrequest_authors_suggestions_expanded') !== 'false');
  const [sortBy, setSortBy] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const searchTimeoutRef = useRef(null);

  const SORTS = [
    { key: 'name', label: 'Nom' },
    { key: 'date', label: 'Suivi le' },
  ];

  const toggleSort = (key) => {
    if (sortBy === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(key); setSortDir(key === 'date' ? 'desc' : 'asc'); }
  };

  // ── Modale de détail ──────────────────────────────────────────────────────
  const [detailAuthor, setDetailAuthor] = useState(null); // { name, bio, openLibraryKey, followedInfo }
  const [books, setBooks] = useState([]);
  const [booksTotal, setBooksTotal] = useState(0);
  const [booksPage, setBooksPage] = useState(1);
  const [booksLoading, setBooksLoading] = useState(false);
  const [duplicateTitles, setDuplicateTitles] = useState(new Set());
  const [requestingId, setRequestingId] = useState(null);
  const [requestedIds, setRequestedIds] = useState(new Set());

  const showAlertMsg = (type, message) => {
    setAlert({ type, message });
    setTimeout(() => setAlert(null), 6000);
  };

  const loadFollowed = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axiosAdmin.get('/api/authors/me/followed');
      setFollowed(res.data.authors || []);
      setConfig(res.data.config || { enabled: true, maxAuthorsPerUser: 50 });
    } catch {
      showAlertMsg('error', 'Impossible de charger vos auteurs suivis.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadFollowed(); }, [loadFollowed]);

  useEffect(() => {
    axiosAdmin.get('/api/authors/recent-releases')
      .then(res => setRecentReleases(res.data.releases || []))
      .catch(() => {});
    axiosAdmin.get('/api/authors/suggestions')
      .then(res => setSuggestions(res.data.suggestions || []))
      .catch(() => {});
  }, []);

  const suggestFollow = async (openLibraryKey) => {
    await follow(openLibraryKey);
    setSuggestions(prev => prev.filter(s => s.openLibraryKey !== openLibraryKey));
  };

  const followedKeys = new Set(followed.map(a => a.openLibraryKey));

  const runSearch = async (q) => {
    setSearching(true);
    setHasSearched(true);
    try {
      const res = await axiosAdmin.get('/api/authors/search', { params: { q } });
      setSearchResults(res.data.authors || []);
    } catch {
      showAlertMsg('error', 'Erreur lors de la recherche.');
    } finally {
      setSearching(false);
    }
  };

  // Recherche au fil de la frappe, même convention que la recherche de livres
  // (GoogleBooksSearch) : debounce 500ms, pas de bouton obligatoire.
  const handleSearchChange = (e) => {
    const v = e.target.value;
    setSearch(v);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (v.trim().length >= MIN_LEN) {
      searchTimeoutRef.current = setTimeout(() => runSearch(v.trim()), 500);
    } else {
      setSearchResults([]);
      setHasSearched(false);
    }
  };

  const follow = async (openLibraryKey) => {
    setBusyKey(openLibraryKey);
    try {
      await axiosAdmin.post(`/api/authors/${openLibraryKey}/follow`, { autoRequest: false });
      showAlertMsg('success', 'Auteur suivi.');
      await loadFollowed();
    } catch (err) {
      showAlertMsg('error', err.response?.data?.error || 'Impossible de suivre cet auteur.');
    } finally {
      setBusyKey(null);
    }
  };

  const unfollow = async (openLibraryKey) => {
    setBusyKey(openLibraryKey);
    try {
      await axiosAdmin.delete(`/api/authors/${openLibraryKey}/follow`);
      showAlertMsg('success', 'Auteur retiré du suivi.');
      await loadFollowed();
    } catch {
      showAlertMsg('error', 'Erreur lors du désabonnement.');
    } finally {
      setBusyKey(null);
    }
  };

  const toggleAutoRequest = async (openLibraryKey, autoRequest) => {
    setBusyKey(openLibraryKey);
    try {
      await axiosAdmin.patch(`/api/authors/${openLibraryKey}/follow`, { autoRequest });
      setFollowed(prev => prev.map(a => a.openLibraryKey === openLibraryKey ? { ...a, autoRequest } : a));
    } catch {
      showAlertMsg('error', 'Erreur lors de la mise à jour.');
    } finally {
      setBusyKey(null);
    }
  };

  // Livres de l'auteur via le même système que "Nouvelle demande"
  // (GET /api/books/search?author=, Google Books → Hardcover → Open Library,
  // déjà paginé et mis en cache côté serveur) plutôt qu'Open Library seul :
  // titres déjà corrects, pas de pool de 50 livres chargé d'un coup.
  const loadBooksPage = async (authorName, page) => {
    setBooksLoading(true);
    try {
      const res = await axiosAdmin.get('/api/books/search', {
        params: { author: authorName, maxResults: BOOKS_PER_PAGE, startIndex: (page - 1) * BOOKS_PER_PAGE },
      });
      const results = res.data.results || [];
      setBooks(results);
      setBooksTotal(res.data.totalItems || 0);
      setBooksPage(page);

      const titles = results.map(b => b.volumeInfo?.title).filter(Boolean);
      if (titles.length > 0) {
        const dup = await axiosAdmin.post('/api/authors/check-duplicates', { author: authorName, titles });
        setDuplicateTitles(new Set(dup.data.duplicateTitles || []));
      } else {
        setDuplicateTitles(new Set());
      }
    } catch {
      showAlertMsg('error', 'Impossible de charger les livres de cet auteur.');
      setBooks([]);
      setBooksTotal(0);
    } finally {
      setBooksLoading(false);
    }
  };

  // `followedInfo` est fourni quand on ouvre la modale depuis la liste des
  // auteurs suivis (pas depuis un résultat de recherche) : porte les
  // contrôles d'abonnement (auto-demande, désabonnement).
  const openDetail = async (openLibraryKey, name, followedInfo = null) => {
    setDetailAuthor({ name, bio: '', openLibraryKey, followedInfo });
    setBooks([]);
    setBooksTotal(0);
    setRequestedIds(new Set());
    try {
      const res = await axiosAdmin.get(`/api/authors/${openLibraryKey}`);
      setDetailAuthor(prev => ({ ...prev, name: res.data.author.name, bio: res.data.author.bio }));
      await loadBooksPage(res.data.author.name, 1);
    } catch {
      showAlertMsg('error', "Impossible de charger les informations de cet auteur.");
      setDetailAuthor(null);
    }
  };

  const unfollowFromModal = async () => {
    await unfollow(detailAuthor.openLibraryKey);
    setDetailAuthor(null);
  };

  const toggleAutoRequestFromModal = async (checked) => {
    await toggleAutoRequest(detailAuthor.openLibraryKey, checked);
    setDetailAuthor(prev => ({ ...prev, followedInfo: { ...prev.followedInfo, autoRequest: checked } }));
  };

  const requestBook = async (book) => {
    const vi = book.volumeInfo || {};
    setRequestingId(book.id);
    try {
      await axiosAdmin.post('/api/requests', {
        title: vi.title,
        author: detailAuthor.name,
        thumbnail: vi.imageLinks?.thumbnail || '',
        publishedDate: vi.publishedDate || '',
        description: vi.description || '',
        pageCount: vi.pageCount || 0,
        category: 'ebook',
      });
      showAlertMsg('success', `Demande créée pour « ${vi.title} ».`);
      setRequestedIds(prev => new Set(prev).add(book.id));
    } catch (err) {
      showAlertMsg('error', err.response?.data?.error || 'Erreur lors de la création de la demande.');
    } finally {
      setRequestingId(null);
    }
  };

  const atLimit = config.maxAuthorsPerUser >= 0 && followed.length >= config.maxAuthorsPerUser;
  const totalPages = Math.max(1, Math.ceil(booksTotal / BOOKS_PER_PAGE));

  const sortedFollowed = [...followed].sort((a, b) => {
    let va, vb;
    if (sortBy === 'name') { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); }
    else { va = new Date(a.followedAt).getTime(); vb = new Date(b.followedAt).getTime(); }
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Auteurs suivis</h1>

      {/* Stats, même convention que Ma bibliothèque */}
      <div className={styles.stats}>
        <div className={styles.statItem}>
          <span className={styles.statNum}>{followed.length}</span>
          <span className={styles.statLabel}>suivi{followed.length > 1 ? 's' : ''}</span>
        </div>
        <div className={styles.statDivider} />
        <div className={styles.statItem}>
          <span className={styles.statNum}>{config.maxAuthorsPerUser >= 0 ? config.maxAuthorsPerUser : '∞'}</span>
          <span className={styles.statLabel}>maximum</span>
        </div>
        <div className={styles.statDivider} />
        <div className={styles.statItem}>
          <span className={styles.statNum}>{followed.filter(a => a.autoRequest).length}</span>
          <span className={styles.statLabel}>auto</span>
        </div>
      </div>

      {recentReleases.length > 0 && (
        <div className={styles.releaseFeed}>
          <p className={styles.sectionTitle}>Dernières sorties détectées</p>
          <div className={styles.releaseList}>
            {recentReleases.map(r => (
              <div key={r._id} className={styles.releaseItem}>
                <span className={styles.releaseDot} />
                <p className={styles.releaseText}>
                  <strong>{r.title}</strong> de {r.author}
                  {r.message === 'Demande effectuée automatiquement.' && (
                    <span className={styles.releaseAuto}> · demande automatique</span>
                  )}
                </p>
                <span className={styles.releaseDate}>{new Date(r.createdAt).toLocaleDateString('fr-FR')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {alert && (
        <div className={`${styles.alert} ${alert.type === 'success' ? styles.alertSuccess : styles.alertError}`}>
          {alert.message}
        </div>
      )}

      {!config.enabled ? (
        <div className={styles.card}>
          <p className={styles.emptyText}>Le suivi d'auteurs est actuellement désactivé par l'administrateur.</p>
        </div>
      ) : (
        <>
          <div className={styles.toolbar}>
            <div className={styles.searchWrap}>
              <span className={styles.searchIcon}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
              </span>
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Rechercher un auteur à suivre..."
                value={search}
                onChange={handleSearchChange}
              />
            </div>

            {followed.length > 1 && (
              <div className={styles.sortBar}>
                {SORTS.map(s => (
                  <button
                    key={s.key}
                    type="button"
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
            )}
          </div>

          {suggestions.length > 0 && (
            <>
              <div className={styles.sectionTitleRow}>
                <p className={styles.sectionTitle}>Peut-être que vous aimeriez suivre</p>
                <button
                  type="button"
                  className={styles.toggleButton}
                  onClick={() => setSuggestionsExpanded(e => {
                    localStorage.setItem('ebookrequest_authors_suggestions_expanded', String(!e));
                    return !e;
                  })}
                  aria-label={suggestionsExpanded ? 'Réduire' : 'Développer'}
                >
                  <svg
                    className={`${styles.chevron} ${suggestionsExpanded ? styles.chevronExpanded : ''}`}
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  >
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </button>
              </div>
              {suggestionsExpanded && (
                <div className={styles.grid}>
                  {suggestions.map(a => (
                    <div key={a.openLibraryKey} className={styles.authorCard}>
                      <AuthorPhoto src={a.photoUrl} alt={a.name} />
                      <p className={styles.authorName} title={a.name}>{a.name}</p>
                      <p className={styles.authorMeta}>{a.reason || ' '}</p>
                      <button
                        type="button"
                        className={styles.btnTest}
                        disabled={atLimit || busyKey === a.openLibraryKey}
                        onClick={() => suggestFollow(a.openLibraryKey)}
                      >
                        {busyKey === a.openLibraryKey ? '…' : 'Suivre'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {atLimit && (
            <p className={styles.limitHint}>
              Limite de {config.maxAuthorsPerUser} auteur(s) suivi(s) atteinte, retirez-en un pour en ajouter un autre.
            </p>
          )}

          {searching ? (
            <p className={styles.emptyText}>Recherche…</p>
          ) : hasSearched && searchResults.length === 0 ? (
            <p className={styles.emptyText}>Aucun auteur trouvé pour « {search} ».</p>
          ) : searchResults.length > 0 && (
            <>
              <p className={styles.sectionTitle}>Résultats de recherche</p>
              <div className={styles.grid}>
                {searchResults.map(a => {
                  const already = followedKeys.has(a.openLibraryKey);
                  return (
                    <div key={a.openLibraryKey} className={styles.authorCard}>
                      <AuthorPhoto src={a.photoUrl} alt={a.name} />
                      <p className={styles.authorName} title={a.name}>{a.name}</p>
                      <p className={styles.authorMeta}>{a.topWork || ' '}</p>
                      <button
                        type="button"
                        className={already ? styles.btnSecondary : styles.btnTest}
                        disabled={already || atLimit || busyKey === a.openLibraryKey}
                        onClick={() => follow(a.openLibraryKey)}
                      >
                        {already ? 'Déjà suivi' : (busyKey === a.openLibraryKey ? '…' : 'Suivre')}
                      </button>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <p className={styles.sectionTitle}>Mes auteurs suivis</p>
          {loading ? (
            <p className={styles.emptyText}>Chargement…</p>
          ) : followed.length === 0 ? (
            <p className={styles.emptyText}>Vous ne suivez aucun auteur pour le moment.</p>
          ) : (
            <div className={styles.grid}>
              {sortedFollowed.map(a => (
                  <div
                    key={a.openLibraryKey}
                    className={styles.authorCard}
                    role="button"
                    tabIndex={0}
                    onClick={() => openDetail(a.openLibraryKey, a.name, a)}
                    onKeyDown={e => { if (e.key === 'Enter') openDetail(a.openLibraryKey, a.name, a); }}
                  >
                    <AuthorPhoto src={a.photoUrl} alt={a.name} />
                    <p className={styles.authorName} title={a.name}>{a.name}</p>
                    {a.autoRequest && <span className={styles.autoBadge}>Demande auto</span>}
                  </div>
                ))}
              </div>
            )}
        </>
      )}

      {detailAuthor && (
        <div className={styles.overlay} onClick={() => setDetailAuthor(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>{detailAuthor.name}</h3>
              <button type="button" className={styles.closeBtn} onClick={() => setDetailAuthor(null)}>×</button>
            </div>

            {detailAuthor.bio && <p className={styles.modalBio}>{detailAuthor.bio}</p>}

            {/* Barre d'options compacte : demande auto à gauche, désabonnement
                discret à droite — tout sur une seule ligne. */}
            <div className={styles.modalToolbar}>
              <div className={styles.modalToolbarLeft}>
                {detailAuthor.followedInfo && (
                  <label className={styles.autoRequestToggle}>
                    <input
                      type="checkbox"
                      checked={detailAuthor.followedInfo.autoRequest}
                      disabled={busyKey === detailAuthor.openLibraryKey}
                      onChange={e => toggleAutoRequestFromModal(e.target.checked)}
                    />
                    Demande auto
                  </label>
                )}
              </div>
              {detailAuthor.followedInfo && (
                <button
                  type="button"
                  className={styles.unfollowLink}
                  disabled={busyKey === detailAuthor.openLibraryKey}
                  onClick={unfollowFromModal}
                >
                  Ne plus suivre
                </button>
              )}
            </div>

            <div className={styles.modalBody}>
              {booksLoading ? (
                <p className={styles.emptyText}>Chargement…</p>
              ) : books.length === 0 ? (
                <p className={styles.emptyText}>Aucun livre trouvé.</p>
              ) : (
                <>
                  <div className={styles.workList}>
                    {books.map(book => {
                      const vi = book.volumeInfo || {};
                      const isDuplicate = duplicateTitles.has(vi.title);
                      const isRequested = requestedIds.has(book.id);
                      return (
                        <div key={book.id} className={styles.workRow}>
                          {vi.imageLinks?.thumbnail ? (
                            <img src={vi.imageLinks.thumbnail} alt="" className={styles.workCover} />
                          ) : (
                            <BookCoverPlaceholder />
                          )}
                          <div className={styles.workInfo}>
                            <p className={styles.workTitle}>{vi.title}</p>
                            {vi.publishedDate && <p className={styles.workDate}>{vi.publishedDate}</p>}
                          </div>
                          <button
                            type="button"
                            className={styles.workRequestBtn}
                            disabled={requestingId === book.id || isRequested || isDuplicate}
                            onClick={() => requestBook(book)}
                            title={isDuplicate ? 'Déjà présent dans vos demandes' : undefined}
                          >
                            {isRequested || isDuplicate ? 'Déjà demandé' : (requestingId === book.id ? '…' : 'Demander')}
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {totalPages > 1 && (
                    <div className={styles.pagination}>
                      <button
                        type="button"
                        className={styles.btnSecondary}
                        disabled={booksPage <= 1 || booksLoading}
                        onClick={() => loadBooksPage(detailAuthor.name, booksPage - 1)}
                      >
                        Précédent
                      </button>
                      <span className={styles.pageIndicator}>Page {booksPage} / {totalPages}</span>
                      <button
                        type="button"
                        className={styles.btnSecondary}
                        disabled={booksPage >= totalPages || booksLoading}
                        onClick={() => loadBooksPage(detailAuthor.name, booksPage + 1)}
                      >
                        Suivant
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
