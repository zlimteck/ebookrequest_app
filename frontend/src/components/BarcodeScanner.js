import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library';
import styles from './BarcodeScanner.module.css';

const BarcodeScanner = ({ onDetected, onClose }) => {
  const videoRef  = useRef(null);
  const readerRef = useRef(null);
  const [error, setError]           = useState('');
  const [facingMode, setFacingMode] = useState('environment'); // caméra arrière par défaut

  const stopCamera = () => {
    readerRef.current?.reset();
    if (videoRef.current?.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
  };

  useEffect(() => {
    readerRef.current = new BrowserMultiFormatReader();
    return () => stopCamera();
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!videoRef.current) return;

    // La caméra nécessite HTTPS (sauf localhost)
    if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost') {
      setError('Le scanner nécessite une connexion HTTPS. Accédez à l\'application via https://');
      return;
    }

    const reader = readerRef.current;
    stopCamera();
    setError('');

    reader.decodeFromConstraints(
      { video: { facingMode: { ideal: facingMode } } },
      videoRef.current,
      (result, err) => {
        if (result) {
          const text = result.getText().replace(/[-\s]/g, '');
          if (/^\d{10}$/.test(text) || /^\d{13}$/.test(text)) {
            stopCamera();
            onDetected(text);
          }
        }
        if (err && !(err instanceof NotFoundException)) {
          console.warn('Scanner error:', err);
        }
      }
    ).catch(() => {
      setError('Impossible d\'accéder à la caméra. Vérifiez les permissions.');
    });

    return () => stopCamera();
  }, [facingMode, onDetected]); // eslint-disable-line

  const switchCamera = () => {
    setFacingMode(f => f === 'environment' ? 'user' : 'environment');
  };

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title}>Scanner le code-barres</span>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Fermer">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div className={styles.viewfinder}>
          <video ref={videoRef} className={styles.video} autoPlay muted playsInline />
          <div className={styles.scanLine} />
          <div className={styles.corners}>
            <span /><span /><span /><span />
          </div>
        </div>

        <p className={styles.hint}>
          Pointez la caméra vers le code-barres ISBN du livre
        </p>

        {error && <p className={styles.error}>{error}</p>}

        <button className={styles.switchBtn} onClick={switchCamera}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
            <path d="M3 3v5h5"/>
          </svg>
          {facingMode === 'environment' ? 'Caméra frontale' : 'Caméra arrière'}
        </button>
      </div>
    </div>
  );
};

export default BarcodeScanner;
