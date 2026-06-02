import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ReactReader, ReactReaderStyle } from 'react-reader';
import JSZip from 'jszip';
import axiosAdmin from '../axiosAdmin';
import styles from './BookReaderModal.module.css';

function getFormat(filePath) {
  if (!filePath) return null;
  const filename = filePath.split(/[\\/]/).pop();
  const ext = filename.split('.').pop().toLowerCase();
  if (ext === 'pdf') return 'pdf';
  if (ext === 'epub') return 'epub';
  if (ext === 'cbz' || ext === 'cbr') return 'cbz';
  return null;
}

export default function BookReaderModal({ book, onClose, onPositionSaved }) {
  // ── Constantes dérivées des props (avant tout useState/useRef) ─────────────
  const req          = book.requestId;
  const readingListId = book._id || null;
  const lsKey        = req?._id ? `epub_pos_${req._id}` : null;
  const cbzLsKey     = req?._id ? `cbz_pos_${req._id}` : null;
  const initialLoc   = book.epubLocation || (lsKey ? localStorage.getItem(lsKey) : null) || null;

  // ── State ──────────────────────────────────────────────────────────────────
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [pdfUrl, setPdfUrl]         = useState(null);
  const [epubBuffer, setEpubBuffer] = useState(null);
  const [format, setFormat]         = useState(null);
  const [fontSize, setFontSize]     = useState(100);
  const [progress, setProgress]     = useState(0);
  const [epubLocation, setEpubLocation] = useState(initialLoc);
  const [cbzImages, setCbzImages]   = useState([]);
  const [cbzPage, setCbzPage]       = useState(() => {
    if (!cbzLsKey) return 0;
    const saved = parseInt(localStorage.getItem(cbzLsKey), 10);
    return isNaN(saved) ? 0 : saved;
  });

  // ── Refs ───────────────────────────────────────────────────────────────────
  const renditionRef = useRef(null);
  const lastLocRef   = useRef(initialLoc);

  // ── Chargement du fichier ──────────────────────────────────────────────────
  useEffect(() => {
    if (!req?.filePath) {
      setError('Fichier non disponible pour la lecture en ligne');
      setLoading(false);
      return;
    }
    const fmt = getFormat(req.filePath);
    setFormat(fmt);
    if (!fmt) {
      setError('Format non supporté (seuls PDF, EPUB et CBZ sont pris en charge)');
      setLoading(false);
      return;
    }

    let objectUrls = [];

    const load = async () => {
      try {
        if (fmt === 'epub') {
          const res = await axiosAdmin.get(`/api/requests/download/${req._id}`, { responseType: 'arraybuffer' });
          setEpubBuffer(res.data);
        } else if (fmt === 'cbz') {
          const res = await axiosAdmin.get(`/api/requests/download/${req._id}`, { responseType: 'blob' });
          const zip = await JSZip.loadAsync(res.data);
          const imageFiles = Object.values(zip.files)
            .filter(f => !f.dir && /\.(jpe?g|png|gif|webp)$/i.test(f.name))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
          const urls = await Promise.all(imageFiles.map(async f => {
            const data = await f.async('blob');
            const url = URL.createObjectURL(data);
            objectUrls.push(url);
            return url;
          }));
          setCbzImages(urls);
        } else {
          const res = await axiosAdmin.get(`/api/requests/download/${req._id}`, { responseType: 'blob' });
          const url = URL.createObjectURL(res.data);
          objectUrls.push(url);
          setPdfUrl(url);
        }
        setLoading(false);
      } catch {
        setError('Erreur lors du chargement du fichier');
        setLoading(false);
      }
    };

    load();
    return () => { objectUrls.forEach(u => URL.revokeObjectURL(u)); objectUrls = []; };
  }, []); // eslint-disable-line

  // ── Taille de police EPUB ──────────────────────────────────────────────────
  useEffect(() => {
    renditionRef.current?.themes.fontSize(`${fontSize}%`);
  }, [fontSize]);

  // ── Changement de page EPUB — sauvegarde immédiate à chaque page ──────────
  const handleLocationChanged = useCallback(async (loc) => {
    setEpubLocation(loc);
    lastLocRef.current = loc;

    if (!loc) return;

    if (readingListId) {
      // Bibliothèque : sauvegarde en base
      try {
        await axiosAdmin.put(`/api/reading/${readingListId}`, { epubLocation: loc });
        onPositionSaved?.(loc);
      } catch {}
    } else if (lsKey) {
      // Pas de bibliothèque (admin, etc.) : sauvegarde en localStorage
      try { localStorage.setItem(lsKey, loc); } catch {}
    }

    // Calcul progression
    const r = renditionRef.current;
    if (r?.book?.locations?.length?.() > 0) {
      const pct = r.book.locations.percentageFromCfi(loc);
      setProgress(Math.round((pct || 0) * 100));
    }
  }, [readingListId, onPositionSaved]);

  // ── Rendition EPUB ─────────────────────────────────────────────────────────
  const handleGetRendition = useCallback((rendition) => {
    renditionRef.current = rendition;
    rendition.themes.register('light', {
      body: { background: '#ffffff !important', color: '#1a1a1a !important' },
    });
    rendition.themes.select('light');
    rendition.themes.fontSize(`${fontSize}%`);
    // Génère les localisations pour la progression
    rendition.book.ready.then(() => {
      rendition.book.locations.generate(1024).catch(() => {});
    }).catch(() => {});
  }, []); // eslint-disable-line

  // ── Navigation clavier ─────────────────────────────────────────────────────
  const handleKey = useCallback((e) => {
    if (e.key === 'Escape') { handleClose(); return; }
    if (format === 'cbz') {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') setCbzPage(p => Math.min(p + 1, cbzImages.length - 1));
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   setCbzPage(p => Math.max(p - 1, 0));
    }
  }, [format, cbzImages.length, onClose]);

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  // Sauvegarde page CBZ dans localStorage
  useEffect(() => {
    if (cbzLsKey && cbzImages.length > 0) {
      try { localStorage.setItem(cbzLsKey, cbzPage); } catch {}
    }
  }, [cbzPage, cbzLsKey, cbzImages.length]);


  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleOverlayClick = (e) => { if (e.target === e.currentTarget) handleClose(); };

  const isEpub = format === 'epub';

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.modal}>

        {/* ── Header ── */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.formatBadge}>{format?.toUpperCase() ?? '—'}</span>
            <span className={styles.bookTitle}>{book.title}</span>
          </div>

          {/* Contrôles taille de police (EPUB uniquement) */}
          {isEpub && !loading && !error && (
            <div className={styles.fontControls}>
              <button className={styles.fontBtn} onClick={() => setFontSize(s => Math.max(70, s - 10))} title="Réduire la police">A−</button>
              <span className={styles.fontSize}>{fontSize}%</span>
              <button className={styles.fontBtn} onClick={() => setFontSize(s => Math.min(200, s + 10))} title="Agrandir la police">A+</button>
            </div>
          )}

          <button className={styles.closeBtn} onClick={handleClose} title="Fermer (Échap)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* ── Contenu ── */}
        <div className={styles.content}>

          {loading && (
            <div className={styles.center}>
              <div className={styles.spinner} />
              <span>Chargement du fichier…</span>
            </div>
          )}

          {!loading && error && (
            <div className={styles.center}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#f87171', marginBottom: '0.75rem' }}>
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span style={{ color: '#f87171' }}>{error}</span>
            </div>
          )}

          {/* ── PDF ── */}
          {!loading && !error && format === 'pdf' && pdfUrl && (
            <iframe src={pdfUrl} className={styles.pdfFrame} title={book.title} />
          )}

          {/* ── EPUB ── */}
          {!loading && !error && isEpub && epubBuffer && (
            <div className={styles.epubWrapper}>
              <ReactReader
                url={epubBuffer}
                location={epubLocation}
                locationChanged={handleLocationChanged}
                epubOptions={{ allowScriptedContent: true, flow: 'paginated' }}
                swipeable
                getRendition={handleGetRendition}
                readerStyles={epubReaderStyles}
              />
              {/* Barre de progression */}
              {progress > 0 && (
                <div className={styles.progressBar}>
                  <div className={styles.progressFill} style={{ width: `${progress}%` }} />
                  <span className={styles.progressLabel}>{progress}%</span>
                </div>
              )}
            </div>
          )}

          {/* ── CBZ ── */}
          {!loading && !error && format === 'cbz' && cbzImages.length > 0 && (
            <div className={styles.cbzWrapper}>
              <div className={styles.cbzLeft}  onClick={() => setCbzPage(p => Math.max(p - 1, 0))} title="Page précédente" />
              <img src={cbzImages[cbzPage]} alt={`Page ${cbzPage + 1}`} className={styles.cbzImage} draggable={false} />
              <div className={styles.cbzRight} onClick={() => setCbzPage(p => Math.min(p + 1, cbzImages.length - 1))} title="Page suivante" />
              <div className={styles.cbzNav}>
                <button className={styles.cbzBtn} onClick={() => setCbzPage(p => Math.max(p - 1, 0))} disabled={cbzPage === 0}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                <span className={styles.cbzCounter}>{cbzPage + 1} / {cbzImages.length}</span>
                <button className={styles.cbzBtn} onClick={() => setCbzPage(p => Math.min(p + 1, cbzImages.length - 1))} disabled={cbzPage === cbzImages.length - 1}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Spread complet des styles par défaut + override uniquement des couleurs
const epubReaderStyles = {
  ...ReactReaderStyle,
  arrow: { ...ReactReaderStyle.arrow, color: '#334155' },
  arrowHover: { color: '#6366f1' },
  tocButtonBar: { ...ReactReaderStyle.tocButtonBar, background: '#555' },
};

// Styles react-reader (non utilisé — conservé pour référence)
const defaultReaderStyles = {
  arrow: {
    outline: 'none', border: 'none',
    background: 'rgba(0,0,0,0.06)',
    borderRadius: '50%',
    position: 'absolute', top: '50%', marginTop: -28,
    fontSize: 48, width: 48, height: 48,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 0, color: '#334155', cursor: 'pointer', userSelect: 'none',
    transition: 'background 0.15s, color 0.15s',
  },
  arrowHover: { background: 'rgba(99,102,241,0.12)', color: '#6366f1' },
  readerArea: { position: 'relative', zIndex: 1, height: '100%', width: '100%', backgroundColor: '#ffffff', transition: 'all .3s ease' },
  containerExpanded: { transform: 'translateX(256px)' },
  titleArea: { position: 'absolute', top: 16, left: 60, right: 60, textAlign: 'center', color: '#94a3b8', fontSize: '11px', fontFamily: 'sans-serif', letterSpacing: '0.03em' },
  tocArea: { position: 'absolute', left: 0, top: 0, bottom: 0, zIndex: 0, width: 256, overflowY: 'auto', WebkitOverflowScrolling: 'touch', background: '#f8fafc', borderRight: '1px solid #e2e8f0', padding: '10px 0' },
  tocButton: { background: 'transparent', border: 'none', cursor: 'pointer' },
  tocButtonBar: { background: '#334155', borderRadius: '2px' },
};
