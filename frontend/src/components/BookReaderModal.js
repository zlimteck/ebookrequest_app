import React, { useState, useEffect, useCallback } from 'react';
import { ReactReader } from 'react-reader';
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

export default function BookReaderModal({ book, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pdfUrl, setPdfUrl] = useState(null);       // blob URL pour PDF (iframe)
  const [epubBuffer, setEpubBuffer] = useState(null); // ArrayBuffer pour EPUB
  const [format, setFormat] = useState(null);
  const [cbzImages, setCbzImages] = useState([]);
  const [cbzPage, setCbzPage] = useState(0);
  const [epubLocation, setEpubLocation] = useState(null);

  const req = book.requestId;

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
          const response = await axiosAdmin.get(`/api/requests/download/${req._id}`, {
            responseType: 'arraybuffer',
          });
          setEpubBuffer(response.data);
        } else if (fmt === 'cbz') {
          const response = await axiosAdmin.get(`/api/requests/download/${req._id}`, {
            responseType: 'blob',
          });
          const zip = await JSZip.loadAsync(response.data);
          const imageFiles = Object.values(zip.files)
            .filter(f => !f.dir && /\.(jpe?g|png|gif|webp)$/i.test(f.name))
            .sort((a, b) =>
              a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
            );
          const urls = await Promise.all(
            imageFiles.map(async f => {
              const data = await f.async('blob');
              const url = URL.createObjectURL(data);
              objectUrls.push(url);
              return url;
            })
          );
          setCbzImages(urls);
        } else {
          // PDF : blob URL pour l'iframe
          const response = await axiosAdmin.get(`/api/requests/download/${req._id}`, {
            responseType: 'blob',
          });
          const url = URL.createObjectURL(response.data);
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

    return () => {
      objectUrls.forEach(u => URL.revokeObjectURL(u));
      objectUrls = [];
    };
  }, []); // eslint-disable-line

  // Navigation clavier
  const handleKey = useCallback((e) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (format === 'cbz') {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown')
        setCbzPage(p => Math.min(p + 1, cbzImages.length - 1));
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
        setCbzPage(p => Math.max(p - 1, 0));
    }
  }, [format, cbzImages.length, onClose]);

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.modal}>

        {/* ── Header ── */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.formatBadge}>{format?.toUpperCase() ?? '—'}</span>
            <span className={styles.bookTitle}>{book.title}</span>
          </div>
          <button className={styles.closeBtn} onClick={onClose} title="Fermer (Échap)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* ── Contenu ── */}
        <div className={styles.content}>

          {/* Chargement */}
          {loading && (
            <div className={styles.center}>
              <div className={styles.spinner} />
              <span>Chargement du fichier…</span>
            </div>
          )}

          {/* Erreur */}
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
            <iframe
              src={pdfUrl}
              className={styles.pdfFrame}
              title={book.title}
            />
          )}

          {/* ── EPUB ── */}
          {!loading && !error && format === 'epub' && epubBuffer && (
            <div className={styles.epubWrapper}>
              <ReactReader
                url={epubBuffer}
                location={epubLocation}
                locationChanged={setEpubLocation}
                epubOptions={{ allowScriptedContent: true, flow: 'paginated' }}
                getRendition={(rendition) => {
                  // Fond blanc + texte noir dans le contenu epub
                  rendition.themes.register('light', {
                    body: { background: '#ffffff !important', color: '#1a1a1a !important' },
                  });
                  rendition.themes.select('light');
                }}
              />
            </div>
          )}

          {/* ── CBZ ── */}
          {!loading && !error && format === 'cbz' && cbzImages.length > 0 && (
            <div className={styles.cbzWrapper}>
              {/* Zone de clic gauche/droite */}
              <div
                className={styles.cbzLeft}
                onClick={() => setCbzPage(p => Math.max(p - 1, 0))}
                title="Page précédente"
              />
              <img
                src={cbzImages[cbzPage]}
                alt={`Page ${cbzPage + 1}`}
                className={styles.cbzImage}
                draggable={false}
              />
              <div
                className={styles.cbzRight}
                onClick={() => setCbzPage(p => Math.min(p + 1, cbzImages.length - 1))}
                title="Page suivante"
              />
              {/* Barre de navigation */}
              <div className={styles.cbzNav}>
                <button
                  className={styles.cbzBtn}
                  onClick={() => setCbzPage(p => Math.max(p - 1, 0))}
                  disabled={cbzPage === 0}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6"/>
                  </svg>
                </button>
                <span className={styles.cbzCounter}>{cbzPage + 1} / {cbzImages.length}</span>
                <button
                  className={styles.cbzBtn}
                  onClick={() => setCbzPage(p => Math.min(p + 1, cbzImages.length - 1))}
                  disabled={cbzPage === cbzImages.length - 1}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Styles react-reader — on surcharge uniquement les couleurs, on garde le comportement par défaut
const defaultReaderStyles = {
  arrow: {
    outline: 'none',
    border: 'none',
    background: 'none',
    position: 'absolute',
    top: '50%',
    marginTop: -32,
    fontSize: 64,
    padding: '0 10px',
    color: '#cbd5e1',
    cursor: 'pointer',
    userSelect: 'none',
  },
  arrowHover: {
    color: '#6366f1',
  },
  readerArea: {
    position: 'relative',
    zIndex: 1,
    height: '100%',
    width: '100%',
    backgroundColor: '#ffffff',
    transition: 'all .3s ease',
  },
  // Indispensable : pousse le reader quand le TOC s'ouvre
  containerExpanded: {
    transform: 'translateX(256px)',
  },
  titleArea: {
    position: 'absolute',
    top: 20,
    left: 50,
    right: 50,
    textAlign: 'center',
    color: '#64748b',
    fontSize: '12px',
  },
  tocArea: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    zIndex: 0,
    width: 256,
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
    background: '#f1f5f9',
    padding: '10px 0',
  },
};