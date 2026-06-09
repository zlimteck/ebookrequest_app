import React, { useState, useEffect, useCallback, useRef } from 'react';
import axiosAdmin from '../axiosAdmin';
import styles from './DownloadModal.module.css';

const FORMAT_LABELS = {
  epub: 'EPUB', mobi: 'MOBI', azw3: 'AZW3', pdf: 'PDF', fb2: 'FB2', cbz: 'CBZ',
};

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return null;
  if (bytes < 1024)        return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

const DownloadIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
);

export default function DownloadModal({ request, onClose }) {
  const [formats, setFormats]             = useState([]);
  const [sourceFormat, setSourceFormat]   = useState(null);
  const [fileSize, setFileSize]           = useState(null);
  const [selectedFormat, setSelectedFormat] = useState('');
  const [converting, setConverting]       = useState(false);
  const [converted, setConverted]         = useState(null); // { format, size, url, filename }
  const [error, setError]                 = useState('');
  const [loadingFormats, setLoadingFormats] = useState(true);

  // Révoquer l'URL objet quand le modal est fermé ou reconverti
  const convertedUrlRef = useRef(null);
  useEffect(() => () => { if (convertedUrlRef.current) window.URL.revokeObjectURL(convertedUrlRef.current); }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await axiosAdmin.get(`/api/requests/${request._id}/convert-formats`);
        setFormats(res.data.formats || []);
        setSourceFormat(res.data.sourceFormat);
        setFileSize(res.data.fileSize);
        if (res.data.formats?.length > 0) setSelectedFormat(res.data.formats[0]);
      } catch {
        setFormats([]);
      } finally {
        setLoadingFormats(false);
      }
    };
    load();
  }, [request._id]);

  const handleDownloadOriginal = useCallback(async () => {
    if (request.downloadLink) {
      window.open(request.downloadLink, '_blank', 'noopener,noreferrer');
      onClose();
      return;
    }
    if (request.filePath) {
      try {
        const response = await axiosAdmin.get(`/api/requests/download/${request._id}`, { responseType: 'blob' });
        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url;
        const disposition = response.headers['content-disposition'] || '';
        const match = disposition.match(/filename\*?=['"]?(?:UTF-8'')?([^;\n"']*)['"]?/i);
        link.setAttribute('download', match?.[1]?.trim() || `ebook_${request._id}`);
        document.body.appendChild(link); link.click(); link.remove();
        window.URL.revokeObjectURL(url);
        onClose();
      } catch {
        setError('Erreur lors du téléchargement');
      }
    }
  }, [request, onClose]);

  const handleConvert = useCallback(async () => {
    if (!selectedFormat) return;
    setConverting(true);
    setError('');
    setConverted(null);
    if (convertedUrlRef.current) { window.URL.revokeObjectURL(convertedUrlRef.current); convertedUrlRef.current = null; }
    try {
      const response = await axiosAdmin.post(
        `/api/requests/${request._id}/convert?format=${selectedFormat}`,
        {},
        { responseType: 'blob', timeout: 180000 }
      );
      const blob = new Blob([response.data]);
      const url = window.URL.createObjectURL(blob);
      convertedUrlRef.current = url;
      const title = (request.title || 'ebook').replace(/[^a-z0-9 .-]/gi, '_');
      setConverted({ format: selectedFormat, size: blob.size, url, filename: `${title}.${selectedFormat}` });
    } catch (err) {
      const msg = err.response?.data instanceof Blob
        ? await err.response.data.text().then(t => { try { return JSON.parse(t).error; } catch { return t; } })
        : err.response?.data?.error || 'Erreur lors de la conversion';
      setError(msg);
    } finally {
      setConverting(false);
    }
  }, [request, selectedFormat]);

  const handleDownloadConverted = useCallback(() => {
    if (!converted) return;
    const link = document.createElement('a');
    link.href = converted.url;
    link.setAttribute('download', converted.filename);
    document.body.appendChild(link); link.click(); link.remove();
    onClose();
  }, [converted, onClose]);

  const handleOverlayClick = (e) => { if (e.target === e.currentTarget) onClose(); };

  const hasFile  = !!(request.downloadLink || request.filePath);
  const srcLabel = sourceFormat ? (FORMAT_LABELS[sourceFormat] || sourceFormat.toUpperCase()) : '—';
  const sizeStr  = formatBytes(fileSize);

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.title}>
            <DownloadIcon />
            <span>Télécharger</span>
          </div>
          <button className={styles.closeBtn} onClick={onClose} title="Fermer">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className={styles.body}>
          <p className={styles.bookTitle}>{request.title}</p>
          {request.author && <p className={styles.bookAuthor}>{request.author}</p>}

          {error && (
            <div className={styles.errorMsg}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {error}
            </div>
          )}

          {/* ── Téléchargement direct ── */}
          {hasFile && (
            <div className={styles.section}>
              <div className={styles.sectionLabel}>Format original</div>
              <button className={styles.downloadBtn} onClick={handleDownloadOriginal} disabled={converting}>
                <DownloadIcon />
                <span>Télécharger en {srcLabel}</span>
                {sizeStr && <span className={styles.sizeBadge}>{sizeStr}</span>}
              </button>
            </div>
          )}

          {/* ── Conversion ── */}
          {!loadingFormats && formats.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionLabel}>Convertir vers</div>
              <div className={styles.convertRow}>
                <select
                  className={styles.formatSelect}
                  value={selectedFormat}
                  onChange={e => { setSelectedFormat(e.target.value); setConverted(null); }}
                  disabled={converting}
                >
                  {formats.map(fmt => (
                    <option key={fmt} value={fmt}>
                      {FORMAT_LABELS[fmt] || fmt.toUpperCase()}
                    </option>
                  ))}
                </select>
                <button
                  className={styles.convertBtn}
                  onClick={handleConvert}
                  disabled={converting || !selectedFormat}
                >
                  {converting
                    ? <><span className={styles.spinner} /> Conversion…</>
                    : <><DownloadIcon /> Convertir</>
                  }
                </button>
              </div>

              {converting && (
                <p className={styles.hint}>
                  La conversion peut prendre jusqu'à quelques minutes…
                </p>
              )}

              {/* Résultat de la conversion : taille + bouton télécharger */}
              {converted && !converting && (
                <div className={styles.convertedResult}>
                  <div className={styles.convertedInfo}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#10b981', flexShrink: 0 }}>
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    <span>
                      {FORMAT_LABELS[converted.format] || converted.format.toUpperCase()} prêt
                      {formatBytes(converted.size) && (
                        <span className={styles.convertedSize}> — {formatBytes(converted.size)}</span>
                      )}
                    </span>
                  </div>
                  <button className={styles.downloadConvertedBtn} onClick={handleDownloadConverted}>
                    <DownloadIcon />
                    Télécharger
                  </button>
                </div>
              )}
            </div>
          )}

          {loadingFormats && (
            <div className={styles.loadingFormats}>
              <span className={styles.spinner} />
              <span>Chargement des options…</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
