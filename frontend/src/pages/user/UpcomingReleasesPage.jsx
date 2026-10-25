import React, { useState, useEffect, useCallback, useRef } from 'react';
import axiosAdmin from '../../axiosAdmin';
import BookPreviewModal from '../../components/BookPreviewModal';
import styles from './UpcomingReleasesPage.module.css';

function toPreviewBook(item) {
  return {
    title: item.title,
    author: item.author || 'Auteur inconnu',
    thumbnail: item.coverUrl || '',
    link: item.link || '',
    createdAt: item.releaseDate,
  };
}

const PER_PAGE = 20;
const MIN_LEN = 2;

const SORTS = [
  { key: 'date', label: 'Date' },
  { key: 'title', label: 'Titre' },
];

const SOURCE_LABELS = { bnf: 'BnF', hardcover: 'Hardcover' };

const SourceBadge = ({ source }) => (
  <span className={`${styles.sourceBadge} ${source === 'hardcover' ? styles.sourceBadgeHardcover : styles.sourceBadgeBnf}`}>
    {SOURCE_LABELS[source] || source}
  </span>
);

const BookCoverPlaceholder = () => (
  <div className={styles.coverPlaceholder}>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  </div>
);

export default function UpcomingReleasesPage() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState(null);
  const [search, setSearch] = useState('');
  const [duplicateIds, setDuplicateIds] = useState(new Set());
  const [requestedIds, setRequestedIds] = useState(new Set());
  const [requestingId, setRequestingId] = useState(null);
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('ebookrequest_upcoming_view') || 'cards');
  const [previewBook, setPreviewBook] = useState(null);
  const [source, setSource] = useState('all');
  const [sortBy, setSortBy] = useState('date');
  const [sortDir, setSortDir] = useState('asc');
  const [sourceCounts, setSourceCounts] = useState({ all: 0, bnf: 0, hardcover: 0 });
  const searchTimeoutRef = useRef(null);

  const setView = (mode) => {
    setViewMode(mode);
    localStorage.setItem('ebookrequest_upcoming_view', mode);
  };

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const showAlertMsg = (type, message) => {
    setAlert({ type, message });
    setTimeout(() => setAlert(null), 6000);
  };

  const load = useCallback(async (p = 1, s = '', src = 'all', srt = 'date', dir = 'asc') => {
    setLoading(true);
    try {
      const res = await axiosAdmin.get('/api/upcoming-releases', {
        params: { page: p, limit: PER_PAGE, search: s, source: src === 'all' ? undefined : src, sort: srt, dir },
      });
      const loaded = res.data.items || [];
      setItems(loaded);
      setTotal(res.data.total || 0);
      setPage(p);
      if (res.data.sourceCounts) setSourceCounts(res.data.sourceCounts);

      const dup = new Set();
      await Promise.all(loaded.map(async (item) => {
        if (!item.author) return;
        try {
          const res2 = await axiosAdmin.get('/api/requests/check-duplicate', { params: { title: item.title, author: item.author } });
          if (res2.data.duplicate) dup.add(item._id);
        } catch { /* best-effort */ }
      }));
      setDuplicateIds(dup);
    } catch {
      showAlertMsg('error', 'Impossible de charger les prochaines sorties.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(1, search, source, sortBy, sortDir); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSourceChange = (src) => {
    setSource(src);
    load(1, search, src, sortBy, sortDir);
  };

  const toggleSort = (key) => {
    const dir = sortBy === key ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc';
    setSortBy(key);
    setSortDir(dir);
    load(1, search, source, key, dir);
  };

  const handleSearchChange = (e) => {
    const v = e.target.value;
    setSearch(v);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (v.trim().length >= MIN_LEN || v.trim().length === 0) {
      searchTimeoutRef.current = setTimeout(() => load(1, v.trim(), source, sortBy, sortDir), 500);
    }
  };

  const requestRelease = async (item) => {
    setRequestingId(item._id);
    try {
      await axiosAdmin.post('/api/requests', {
        title: item.title,
        author: item.author || 'Auteur inconnu',
        thumbnail: item.coverUrl || '',
        publishedDate: item.releaseDate ? item.releaseDate.slice(0, 10) : '',
        category: 'ebook',
      });
      showAlertMsg('success', `Demande créée pour « ${item.title} ».`);
      setRequestedIds(prev => new Set(prev).add(item._id));
    } catch (err) {
      showAlertMsg('error', err.response?.data?.error || 'Erreur lors de la création de la demande.');
    } finally {
      setRequestingId(null);
    }
  };

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Prochaines sorties</h1>

      <div className={styles.searchWrap}>
        <span className={styles.searchIcon}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </span>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Rechercher par titre ou auteur..."
          value={search}
          onChange={handleSearchChange}
        />
        <div className={styles.viewToggle}>
          <button
            type="button"
            className={`${styles.viewBtn} ${viewMode === 'cards' ? styles.viewBtnActive : ''}`}
            onClick={() => setView('cards')}
            title="Vue grille"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
              <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
            </svg>
          </button>
          <button
            type="button"
            className={`${styles.viewBtn} ${viewMode === 'list' ? styles.viewBtnActive : ''}`}
            onClick={() => setView('list')}
            title="Vue liste"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      <div className={styles.filterRow}>
        <div className={styles.filterBarWrapper}>
          <div className={styles.filterBar}>
            {[
              { key: 'all', label: 'Toutes', color: null },
              { key: 'bnf', label: 'BnF', color: '#6366f1' },
              { key: 'hardcover', label: 'Hardcover', color: '#f59e0b' },
            ].map(({ key, label, color }) => (
              <button
                key={key}
                type="button"
                className={`${styles.filterPill} ${source === key ? styles.filterPillActive : ''}`}
                style={source === key && color ? { background: color + '1a', color } : {}}
                onClick={() => handleSourceChange(key)}
              >
                {color && <span className={styles.filterDot} style={{ background: color }} />}
                {label}
                {sourceCounts[key] > 0 && <span className={styles.filterCount}>{sourceCounts[key]}</span>}
              </button>
            ))}
          </div>
        </div>

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
                    ? <polyline points="18 15 12 9 6 15" />
                    : <polyline points="6 9 12 15 18 9" />}
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>

      {alert && (
        <div className={`${styles.alert} ${alert.type === 'success' ? styles.alertSuccess : styles.alertError}`}>
          {alert.message}
        </div>
      )}

      {loading ? (
        <p className={styles.emptyText}>Chargement…</p>
      ) : items.length === 0 ? (
        <div className={styles.emptyState}>
          <p>Aucune sortie à venir trouvée{search ? ` pour « ${search} »` : ''}.</p>
        </div>
      ) : (
        <>
          {viewMode === 'list' ? (
            <div className={styles.tableWrapper}>
              <table className={styles.releasesTable}>
                <thead className={styles.tableHead}>
                  <tr>
                    <th className={styles.tableTh}>Titre / Auteur</th>
                    <th className={styles.tableTh}>Éditeur</th>
                    <th className={styles.tableTh}>Parution</th>
                    <th className={styles.tableTh}>Source</th>
                    <th className={styles.tableTh} style={{ width: '1%', whiteSpace: 'nowrap' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => {
                    const isDuplicate = duplicateIds.has(item._id);
                    const isRequested = requestedIds.has(item._id);
                    return (
                      <tr key={item._id} className={styles.tableRow}>
                        <td className={styles.tableTd}>
                          <div className={styles.tableTitleCell}>
                            <div className={styles.coverClickable} onClick={() => setPreviewBook(toPreviewBook(item))}>
                              {item.coverUrl ? (
                                <img src={item.coverUrl} alt="" className={styles.tableCover} />
                              ) : (
                                <div className={styles.tableCoverPlaceholder}><BookCoverPlaceholder /></div>
                              )}
                            </div>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{item.title}</div>
                              <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>{item.author || 'Auteur inconnu'}</div>
                            </div>
                          </div>
                        </td>
                        <td className={styles.tableTd} style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                          {item.publisher || '—'}
                        </td>
                        <td className={styles.tableTd} style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                          {new Date(item.releaseDate).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                        </td>
                        <td className={styles.tableTd}>
                          <SourceBadge source={item.source} />
                        </td>
                        <td className={styles.tableTd}>
                          <button
                            type="button"
                            className={styles.requestBtn}
                            disabled={requestingId === item._id || isRequested || isDuplicate}
                            onClick={() => requestRelease(item)}
                            title={isDuplicate ? 'Déjà présent dans les demandes' : undefined}
                          >
                            {isRequested || isDuplicate ? 'Déjà demandé' : (requestingId === item._id ? '…' : 'Demander')}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={styles.grid}>
              {items.map(item => {
                const isDuplicate = duplicateIds.has(item._id);
                const isRequested = requestedIds.has(item._id);
                return (
                  <div key={item._id} className={styles.card}>
                    <div className={styles.bookCover} onClick={() => setPreviewBook(toPreviewBook(item))}>
                      {item.coverUrl ? (
                        <img src={item.coverUrl} alt="" className={styles.coverImage} />
                      ) : (
                        <div className={styles.noCoverPlaceholder}><BookCoverPlaceholder /></div>
                      )}
                    </div>
                    <div className={styles.cardContent}>
                      <div className={styles.cardHeader}>
                        <h3 className={styles.cardTitle}>{item.title}</h3>
                        <span className={styles.releaseBadge}>
                          {new Date(item.releaseDate).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </span>
                      </div>
                      <p className={styles.cardAuthor}>{item.author || 'Auteur inconnu'}</p>
                      {item.publisher && <p className={styles.cardPublisher}>{item.publisher}</p>}
                      <SourceBadge source={item.source} />
                      <button
                        type="button"
                        className={styles.requestBtn}
                        disabled={requestingId === item._id || isRequested || isDuplicate}
                        onClick={() => requestRelease(item)}
                        title={isDuplicate ? 'Déjà présent dans les demandes' : undefined}
                      >
                        {isRequested || isDuplicate ? 'Déjà demandé' : (requestingId === item._id ? '…' : 'Demander')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {totalPages > 1 && (
            <div className={styles.pagination}>
              <button
                type="button"
                className={styles.pageButton}
                disabled={page <= 1}
                onClick={() => load(page - 1, search, source, sortBy, sortDir)}
              >
                Précédent
              </button>
              <span className={styles.pageInfo}>Page {page} / {totalPages}</span>
              <button
                type="button"
                className={styles.pageButton}
                disabled={page >= totalPages}
                onClick={() => load(page + 1, search, source, sortBy, sortDir)}
              >
                Suivant
              </button>
            </div>
          )}
        </>
      )}

      {previewBook && <BookPreviewModal book={previewBook} onClose={() => setPreviewBook(null)} />}
    </div>
  );
}
