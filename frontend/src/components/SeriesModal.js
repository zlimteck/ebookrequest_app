import React, { useEffect, useState, useCallback, useMemo } from 'react';
import axiosAdmin from '../axiosAdmin';
import styles from './SeriesModal.module.css';

const isoToFr = (str) => {
  if (!str) return '';
  const parts = str.split('-');
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[1]}/${parts[0]}`;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
};

const SeriesModal = ({ seriesName, currentBookId, currentBook, existingRequests, quotaRemaining = Infinity, onClose, onSubmitted }) => {
  const [tomes, setTomes]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [selected, setSelected]   = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult]       = useState(null); // { added, blocked }


  const alreadyRequestedIds = useMemo(() =>
    new Set((existingRequests || []).map(r => r.googleBooksId).filter(Boolean)),
    [existingRequests]
  );
  const alreadyRequestedTitles = useMemo(() =>
    new Set((existingRequests || []).map(r => r.title?.toLowerCase().trim())),
    [existingRequests]
  );

  const isAlreadyRequested = useCallback((tome) => {
    return alreadyRequestedIds.has(tome.id) ||
      alreadyRequestedTitles.has(tome.volumeInfo?.title?.toLowerCase().trim());
  }, [alreadyRequestedIds, alreadyRequestedTitles]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    axiosAdmin.get('/api/books/series-tomes', { params: { name: seriesName, excludeId: currentBookId } })
      .then(({ data }) => {
        if (cancelled) return;
        setTomes(data.results || []);
        const initial = {};
        (data.results || []).forEach(t => {
          if (!isAlreadyRequested(t)) initial[t.id] = true;
        });
        setSelected(initial);
      })
      .catch(() => {
        if (!cancelled) setTomes([]);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [seriesName, currentBookId, isAlreadyRequested]);

  const toggle = (id) => setSelected(prev => ({ ...prev, [id]: !prev[id] }));

  const handleSubmit = async () => {
    const toRequest = tomes.filter(t => selected[t.id] && !isAlreadyRequested(t));
    if (!toRequest.length) return;
    setSubmitting(true);
    let added = 0;
    let blocked = 0;
    for (const tome of toRequest) {
      const vi = tome.volumeInfo;
      try {
        await axiosAdmin.post('/api/requests', {
          title:         vi.title,
          author:        vi.authors?.[0] || currentBook?.author || '',
          link:          vi.infoLink || `https://books.google.fr/books?id=${tome.id}`,
          thumbnail:     vi.imageLinks?.thumbnail || '',
          description:   vi.description || '',
          pageCount:     vi.pageCount   || 0,
          publishedDate: vi.publishedDate || '',
          format:        currentBook?.format   || '',
          category:      currentBook?.category || 'ebook',
          googleBooksId: tome.id,
          seriesName,
          seriesIndex:   detectSeriesIndex(vi.title, vi.seriesInfo),
        });
        added++;
      } catch (err) {
        if (err.response?.status === 429) blocked++;
      }
    }
    setResult({ added, blocked });
    if (added > 0) onSubmitted?.();
    setSubmitting(false);
  };

  const selectedCount = tomes.filter(t => selected[t.id] && !isAlreadyRequested(t)).length;
  const overQuota     = isFinite(quotaRemaining) && selectedCount > quotaRemaining;

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.icon}>📚</span>
          <div>
            <h2 className={styles.title}>Série détectée</h2>
            <p className={styles.subtitle}>{seriesName}</p>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {result ? (
          <div className={styles.doneState}>
            <span className={styles.doneIcon}>✓</span>
            <p>
              {result.added > 0 && <><strong>{result.added}</strong> tome{result.added > 1 ? 's' : ''} ajouté{result.added > 1 ? 's' : ''} à vos demandes.</>}
              {result.blocked > 0 && (
                <span className={styles.blockedNote}>
                  {result.added > 0 ? ' ' : ''}<strong>{result.blocked}</strong> tome{result.blocked > 1 ? 's' : ''} non ajouté{result.blocked > 1 ? 's' : ''} — quota atteint.
                </span>
              )}
            </p>
            <button className={styles.btnPrimary} onClick={onClose}>Fermer</button>
          </div>
        ) : (
          <>
            <p className={styles.intro}>
              D'autres tomes de cette série sont disponibles. Sélectionnez ceux que vous souhaitez demander.
            </p>

            {loading ? (
              <div className={styles.loadingRow}>
                <div className={styles.spinner} />
                <span>Recherche des tomes…</span>
              </div>
            ) : tomes.length === 0 ? (
              <p className={styles.empty}>Aucun autre tome trouvé pour cette série.</p>
            ) : (
              <ul className={styles.list}>
                {tomes.map(tome => {
                  const vi       = tome.volumeInfo;
                  const already  = isAlreadyRequested(tome);
                  const isChecked = !!selected[tome.id];
                  return (
                    <li
                      key={tome.id}
                      className={`${styles.item} ${already ? styles.itemDisabled : ''} ${isChecked && !already ? styles.itemSelected : ''}`}
                      onClick={() => !already && toggle(tome.id)}
                    >
                      {vi.imageLinks?.thumbnail ? (
                        <img src={vi.imageLinks.thumbnail} alt="" className={styles.thumb} />
                      ) : (
                        <div className={styles.thumbPlaceholder} />
                      )}
                      <div className={styles.info}>
                        <span className={styles.tomeTitle}>{vi.title}</span>
                        {vi.publishedDate && (
                          <span className={styles.tomeMeta}>{isoToFr(vi.publishedDate)}</span>
                        )}
                        {vi.authors?.[0] && (
                          <span className={styles.tomeMeta}>{vi.authors[0]}</span>
                        )}
                      </div>
                      {already ? (
                        <span className={styles.alreadyBadge}>Déjà demandé</span>
                      ) : (
                        <input
                          type="checkbox"
                          className={styles.checkbox}
                          checked={isChecked}
                          onChange={() => toggle(tome.id)}
                          onClick={e => e.stopPropagation()}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {overQuota && (
              <div className={styles.quotaWarning}>
                ⚠️ Il vous reste <strong>{quotaRemaining}</strong> demande{quotaRemaining > 1 ? 's' : ''} disponible{quotaRemaining > 1 ? 's' : ''}. Seuls les {quotaRemaining} premier{quotaRemaining > 1 ? 's' : ''} tome{quotaRemaining > 1 ? 's' : ''} sélectionné{quotaRemaining > 1 ? 's' : ''} seront ajoutés.
              </div>
            )}
            <div className={styles.footer}>
              <button className={styles.btnSecondary} onClick={onClose}>Non merci</button>
              {selectedCount > 0 && (
                <button
                  className={styles.btnPrimary}
                  onClick={handleSubmit}
                  disabled={submitting}
                >
                  {submitting ? 'Envoi…' : `Demander ${selectedCount} tome${selectedCount > 1 ? 's' : ''}`}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

function detectSeriesIndex(title, seriesInfo) {
  if (seriesInfo?.bookDisplayNumber) return parseInt(seriesInfo.bookDisplayNumber) || null;
  if (seriesInfo?.volumeSeries?.[0]?.orderNumber) return seriesInfo.volumeSeries[0].orderNumber;
  const patterns = [/tome\s*(\d+)/i, /vol(?:ume)?\.?\s*(\d+)/i, /#\s*(\d+)/i, /,\s*t\s*(\d+)/i];
  for (const p of patterns) {
    const m = (title || '').match(p);
    if (m) return parseInt(m[1]);
  }
  return null;
}

export default SeriesModal;
