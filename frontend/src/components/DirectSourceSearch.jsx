import React, { useState, useEffect } from 'react';
import axiosAdmin from '../axiosAdmin';
import ShelfPicker from './ShelfPicker';
import gStyles from './GoogleBooksSearch.module.css';
import styles from './DirectSourceSearch.module.css';

const MIN_LEN = 2;

// Même pacing que le cron Valentine côté serveur (valentineCron.js) entre
// chaque livre d'un lot : délai aléatoire 45-90s, volontairement gros — c'est
// la mesure ajoutée après le ban de compte passé, pour casser tout pattern de
// requêtes régulier. Un lot déclenché depuis la recherche directe (plusieurs
// vrais téléchargements Valentine d'affilée, dans la même session) suit
// exactement le même risque qu'un lot traité par le cron, donc la même règle.
const DELAY_MIN_MS = 45000;
const DELAY_MAX_MS = 90000;
function randomDelay() {
  return DELAY_MIN_MS + Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS);
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
function estimateBatchMinutes(n) {
  if (n <= 1) return null;
  const totalMs = (n - 1) * ((DELAY_MIN_MS + DELAY_MAX_MS) / 2) + n * 4000;
  return Math.max(1, Math.round(totalMs / 60000));
}

const MODES = [
  { value: 'title',  label: 'Titre'   },
  { value: 'author', label: 'Auteur'  },
  { value: 'series', label: 'Série'   },
];

const VALID_MODES = MODES.map(m => m.value);

const PLACEHOLDERS = {
  title:  'Titre exact du livre…',
  author: "Nom de l'auteur…",
  series: 'Nom de la série…',
};

/**
 * Recherche directe sur Valentine, sans passer par Google Books/Open
 * Library/Hardcover — inspirée du comportement de valentine_2.py (script CLI
 * qui fonctionne bien en pratique) :
 * - Titre : recherche directe, résultats déjà téléchargeables.
 * - Auteur / Série : recherche en DEUX temps — une liste rapide de
 *   correspondances (nom seulement, pas d'enrichissement), l'utilisateur
 *   clique sur la bonne fiche, puis on charge sa bibliographie complète.
 *   (l'auto-sélection du 1er résultat s'est révélée peu fiable : Valentine
 *   classe par pertinence texte, pas par exactitude du nom).
 *
 * Pas de mode "Globale" : Valentine n'a pas de recherche combinée
 * titre+auteur côté serveur — retiré plutôt que de garder un mode dont le nom
 * laissait croire à une capacité qui n'existe pas.
 *
 * Un bouton "Télécharger" explicite sur chaque résultat crée la demande ET
 * lance le téléchargement (POST /api/requests/direct-download), avec un
 * retour synchrone affiché ici. Sélection multiple possible (cercle sur la
 * couverture, comme la recherche standard) pour tout lancer en lot.
 */
const DirectSourceSearch = ({
  onCompleted,
  targetUserId,
  calibreEnabled,
  calibreShelves = [],
  extraTargetCandidates = [],
}) => {
  const [mode, setMode] = useState(() => {
    const stored = localStorage.getItem('ebookrequest_direct_mode');
    return VALID_MODES.includes(stored) ? stored : 'title';
  });
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState('');

  // Résultats "plats" (mode titre)
  const [titleResults, setTitleResults] = useState([]);
  // Liste légère de correspondances auteur/série (étape 1) — noms seulement
  const [matches, setMatches] = useState([]);

  // Fiche auteur/série choisie (étape 2) + ses livres enrichis
  const [selectedGroup, setSelectedGroup] = useState(null); // { type, name, url }
  const [groupBooks, setGroupBooks] = useState([]);
  const [isLoadingBooks, setIsLoadingBooks] = useState(false);

  const [downloadingId, setDownloadingId] = useState(null);
  const [message, setMessage] = useState({ text: '', type: '' });

  // Sélection multiple pour téléchargement en lot — id -> book, partagée par
  // la vue actuellement affichée (résultats titre OU livres d'un groupe).
  const [selectedBooks, setSelectedBooks] = useState(new Map());
  const [batchDownloading, setBatchDownloading] = useState(false);
  const [batchProgress, setBatchProgress] = useState(null); // { current, total }

  // Étagères — état local propre à ce flux (indépendant du formulaire manuel)
  const [selectedShelves, setSelectedShelves] = useState(
    calibreShelves.filter(s => s.isDefault).map(s => s.name)
  );
  const [extraShelfSelections, setExtraShelfSelections] = useState({});

  useEffect(() => {
    setSelectedShelves(calibreShelves.filter(s => s.isDefault).map(s => s.name));
  }, [calibreShelves]);

  const toggleShelf = (name) => {
    setSelectedShelves(prev => prev.includes(name) ? prev.filter(s => s !== name) : [...prev, name]);
  };

  const toggleExtraShelf = (userId, shelfName) => {
    setExtraShelfSelections(prev => {
      const current = prev[userId] || [];
      const next = current.includes(shelfName) ? current.filter(s => s !== shelfName) : [...current, shelfName];
      const updated = { ...prev };
      if (next.length) updated[userId] = next; else delete updated[userId];
      return updated;
    });
  };

  const resetResults = () => {
    setTitleResults([]);
    setMatches([]);
    setSelectedGroup(null);
    setGroupBooks([]);
    setSelectedBooks(new Map());
    setError('');
    setMessage({ text: '', type: '' });
  };

  const switchMode = (newMode) => {
    if (newMode === mode) return;
    setMode(newMode);
    localStorage.setItem('ebookrequest_direct_mode', newMode);
    setHasSearched(false);
    resetResults();
  };

  const runSearch = async (e) => {
    e?.preventDefault();
    const q = query.trim();
    if (q.length < MIN_LEN) return;

    setIsLoading(true);
    setHasSearched(true);
    resetResults();

    try {
      const res = await axiosAdmin.get('/api/requests/direct-search', { params: { mode, q } });

      if (res.data.unavailable) {
        setError(res.data.error || 'Valentine est injoignable pour le moment.');
        return;
      }

      if (mode === 'author' || mode === 'series') {
        setMatches(res.data.matches || []);
        if (!(res.data.matches || []).length) {
          setError(mode === 'author'
            ? 'Aucun auteur trouvé sur Valentine pour cette recherche.'
            : 'Aucune série trouvée sur Valentine pour cette recherche.');
        }
      } else {
        setTitleResults(res.data.results || []);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de la recherche.');
    } finally {
      setIsLoading(false);
    }
  };

  // Étape 2 : l'utilisateur a cliqué sur un auteur ou une série précis(e)
  const openGroup = async (type, item) => {
    setSelectedGroup({ type, name: item.name, url: item.url });
    setGroupBooks([]);
    setSelectedBooks(new Map());
    setError('');
    setMessage({ text: '', type: '' });
    setIsLoadingBooks(true);
    try {
      const res = await axiosAdmin.get('/api/requests/direct-search-books', {
        params: { type, url: item.url, name: item.name },
      });
      if (res.data.unavailable) {
        setError(res.data.error || 'Valentine est injoignable pour le moment.');
      } else {
        setGroupBooks(res.data.results || []);
        if (!(res.data.results || []).length) {
          setError(`Aucun livre listé sur cette fiche ${type === 'series' ? 'série' : 'auteur'}.`);
        }
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Erreur lors du chargement des livres.');
    } finally {
      setIsLoadingBooks(false);
    }
  };

  const closeGroup = () => {
    setSelectedGroup(null);
    setGroupBooks([]);
    setSelectedBooks(new Map());
    setError('');
  };

  const toggleSelect = (e, book) => {
    e.stopPropagation();
    setSelectedBooks(prev => {
      const next = new Map(prev);
      if (next.has(book.id)) next.delete(book.id); else next.set(book.id, book);
      return next;
    });
  };

  const buildPayload = (book) => {
    const extraShelfTargets = Object.entries(extraShelfSelections)
      .filter(([, shelves]) => shelves.length)
      .map(([userId, shelves]) => ({ userId, shelves }));

    return {
      ebookId: book.id,
      title: book.title,
      author: book.author || (selectedGroup?.type === 'author' ? selectedGroup.name : '') || '',
      link: book.valentineUrl || '',
      category: 'ebook',
      ...(targetUserId && { targetUserId }),
      ...(calibreEnabled && { selectedShelves }),
      ...(extraShelfTargets.length && { extraShelfTargets }),
    };
  };

  // Coeur partagé par le téléchargement simple et le téléchargement en lot —
  // ne touche à aucun state de progression, se contente de renvoyer le résultat.
  const performDownload = async (book) => {
    try {
      const res = await axiosAdmin.post('/api/requests/direct-download', buildPayload(book));
      if (res.data.success) return { ok: true, request: res.data.request };
      return { ok: false, partial: true, error: res.data.error, request: res.data.request };
    } catch (err) {
      return { ok: false, error: err.response?.data?.error || 'Erreur lors de la création de la demande.' };
    }
  };

  const handleDownload = async (book) => {
    if (downloadingId || batchDownloading) return;
    setDownloadingId(book.id);
    setMessage({ text: '', type: '' });

    const result = await performDownload(book);
    if (result.ok) {
      setMessage({ text: `« ${book.title} » téléchargé et ajouté à vos demandes.`, type: 'success' });
    } else if (result.partial) {
      setMessage({
        text: `Demande créée pour « ${book.title} », mais le téléchargement automatique a échoué (${result.error || 'raison inconnue'}). Un admin pourra relancer manuellement.`,
        type: 'warning',
      });
    } else {
      setMessage({ text: result.error, type: 'error' });
    }
    if (onCompleted) onCompleted(result.request);
    setDownloadingId(null);
  };

  const handleBatchDownload = async () => {
    const books = Array.from(selectedBooks.values());
    if (!books.length || batchDownloading || downloadingId) return;

    setBatchDownloading(true);
    setMessage({ text: '', type: '' });
    let ok = 0, partial = 0, failed = 0;

    for (let i = 0; i < books.length; i++) {
      setBatchProgress({ current: i + 1, total: books.length, waiting: false });
      const result = await performDownload(books[i]);
      if (result.ok) ok++;
      else if (result.partial) partial++;
      else failed++;

      // Pause anti-détection entre deux livres (voir constantes en haut du fichier)
      if (i < books.length - 1) {
        setBatchProgress({ current: i + 1, total: books.length, waiting: true });
        await sleep(randomDelay());
      }
    }

    setBatchProgress(null);
    setBatchDownloading(false);
    setSelectedBooks(new Map());

    const parts = [];
    if (ok) parts.push(`${ok} téléchargé${ok > 1 ? 's' : ''}`);
    if (partial) parts.push(`${partial} en attente (échec auto)`);
    if (failed) parts.push(`${failed} échoué${failed > 1 ? 's' : ''}`);
    setMessage({ text: `Lot terminé — ${parts.join(', ')}.`, type: failed ? 'warning' : 'success' });

    if (onCompleted) onCompleted();
  };

  const renderBookGrid = (books) => (
    <>
      {selectedBooks.size === 0 ? (
        <p className={gStyles.batchHint}>Cliquez sur les couvertures pour sélectionner plusieurs livres à télécharger en une fois</p>
      ) : (
        <div className={gStyles.batchBar}>
          {batchDownloading && batchProgress ? (
            <>
              <svg className={gStyles.spinIcon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
              <span className={gStyles.batchCount}>
                {batchProgress.waiting
                  ? `Pause anti-détection… (${batchProgress.current}/${batchProgress.total} fait${batchProgress.current > 1 ? 's' : ''})`
                  : `Téléchargement en cours… ${batchProgress.current}/${batchProgress.total}`}
              </span>
              <div className={gStyles.batchProgressBar}>
                <div className={gStyles.batchProgressFill} style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }} />
              </div>
            </>
          ) : (
            <>
              <span className={gStyles.batchCount}>{selectedBooks.size} livre{selectedBooks.size > 1 ? 's' : ''} sélectionné{selectedBooks.size > 1 ? 's' : ''}</span>
              <button className={gStyles.batchBtn} onClick={handleBatchDownload} disabled={batchDownloading}>
                Télécharger les {selectedBooks.size} livres{estimateBatchMinutes(selectedBooks.size) ? ` (~${estimateBatchMinutes(selectedBooks.size)} min)` : ''}
              </button>
              <button className={gStyles.batchClear} onClick={() => setSelectedBooks(new Map())}>Tout désélectionner</button>
            </>
          )}
        </div>
      )}
      <div className={gStyles.booksGrid}>
        {books.map((book) => {
          const isSelected = selectedBooks.has(book.id);
          return (
            <div key={book.id} className={`${gStyles.bookCard} ${isSelected ? gStyles.bookCardSelected : ''}`}>
              <div className={gStyles.bookCover}>
                {book.cover ? (
                  <img src={book.cover} alt={book.title} />
                ) : (
                  <div className={gStyles.noCover}>📚<br /><span>Pas de couverture</span></div>
                )}
                <div
                  className={`${gStyles.selectCircle} ${isSelected ? gStyles.selectCircleActive : ''}`}
                  onClick={(e) => toggleSelect(e, book)}
                  title={isSelected ? 'Désélectionner' : 'Sélectionner'}
                >
                  {isSelected && (
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="2,6 5,9 10,3"/>
                    </svg>
                  )}
                </div>
              </div>
              <div className={gStyles.bookInfo}>
                <div className={gStyles.bookTitleRow}>
                  <h4>{book.title}</h4>
                </div>
                {book.author && <p className={gStyles.bookAuthor}>{book.author}</p>}
                {book.size && <p className={gStyles.bookMeta}>{book.size}</p>}
              </div>
              <div className={styles.downloadCol}>
                <button
                  type="button"
                  className={styles.downloadBtn}
                  onClick={() => handleDownload(book)}
                  disabled={!!downloadingId || batchDownloading}
                >
                  {downloadingId === book.id ? '…' : 'Télécharger'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );

  const renderMatchList = (list, type) => (
    <div className={styles.matchList}>
      {list.map((m) => (
        <button key={m.id} type="button" className={styles.matchItem} onClick={() => openGroup(type, m)}>
          <span>{m.name}</span>
          <span className={styles.matchArrow}>→</span>
        </button>
      ))}
    </div>
  );

  const shelfPickerVisible = calibreEnabled || extraTargetCandidates.length > 0;

  return (
    <div className={styles.directSearch}>
      <p className={styles.warningNote}>
        Recherche directe sur Valentine — ignore Google Books/Open Library/Hardcover.
        Le résultat choisi est téléchargé immédiatement au clic sur "Télécharger",
        sans passer par les champs du formulaire.
      </p>

      <div className={styles.modeToggle}>
        {MODES.map(m => (
          <button
            key={m.value}
            type="button"
            className={`${styles.modeBtn} ${mode === m.value ? styles.modeBtnActive : ''}`}
            onClick={() => switchMode(m.value)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <form onSubmit={runSearch} className={styles.searchRow}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={PLACEHOLDERS[mode]}
          className={styles.searchInput}
        />
        <button type="submit" className={styles.searchBtn} disabled={query.trim().length < MIN_LEN || isLoading}>
          {isLoading ? 'Recherche…' : 'Rechercher'}
        </button>
      </form>

      {shelfPickerVisible && (
        <div className={styles.shelfRow}>
          <ShelfPicker
            calibreEnabled={calibreEnabled}
            calibreShelves={calibreShelves}
            selectedShelves={selectedShelves}
            toggleShelf={toggleShelf}
            extraTargetCandidates={extraTargetCandidates}
            extraShelfSelections={extraShelfSelections}
            toggleExtraShelf={toggleExtraShelf}
          />
          <span className={styles.shelfHint}>S'applique au(x) prochain(s) livre(s) téléchargé(s)</span>
        </div>
      )}

      {message.text && (
        <div className={`${styles.message} ${styles[message.type] || ''}`}>{message.text}</div>
      )}

      {/* Vue "livres" d'un auteur/série choisi — prioritaire sur le reste */}
      {selectedGroup ? (
        <>
          <button type="button" className={styles.backBtn} onClick={closeGroup}>
            ← {selectedGroup.type === 'series' ? 'Autres séries' : 'Autres auteurs'}
          </button>
          <div className={styles.groupBanner}>
            {selectedGroup.type === 'series' ? 'Série' : 'Auteur'} : <strong>{selectedGroup.name}</strong>
          </div>

          {error && !isLoadingBooks && <div className={styles.errorNote}>{error}</div>}

          <div className={gStyles.resultsContainer}>
            {isLoadingBooks ? (
              <div className={gStyles.loading}>
                <div className={gStyles.loadingSpinner}></div>
                <p>Chargement des livres…</p>
              </div>
            ) : groupBooks.length > 0 ? (
              renderBookGrid(groupBooks)
            ) : null}
          </div>
        </>
      ) : (
        <>
          {error && !isLoading && <div className={styles.errorNote}>{error}</div>}

          <div className={gStyles.resultsContainer}>
            {isLoading ? (
              <div className={gStyles.loading}>
                <div className={gStyles.loadingSpinner}></div>
                <p>Recherche en cours…</p>
              </div>
            ) : mode === 'author' || mode === 'series' ? (
              matches.length > 0 ? renderMatchList(matches, mode) : null
            ) : titleResults.length > 0 ? (
              renderBookGrid(titleResults)
            ) : hasSearched ? (
              <div className={gStyles.noResults}>
                <p>Aucun résultat trouvé pour "{query}"</p>
              </div>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
};

export default DirectSourceSearch;
