import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, NotFoundException } from '@zxing/library';
import styles from './BarcodeScanner.module.css';

const BarcodeScanner = ({ onDetected, onClose }) => {
  const videoRef    = useRef(null);
  const readerRef   = useRef(null);
  const [error, setError]       = useState('');
  const [cameras, setCameras]   = useState([]);
  const [camIndex, setCamIndex] = useState(0);

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    readerRef.current = reader;

    reader.listVideoInputDevices()
      .then(devices => {
        if (!devices.length) { setError('Aucune caméra disponible.'); return; }
        // Préférer la caméra arrière sur mobile
        const sorted = [...devices].sort((a, b) => {
          const aBack = /back|rear|environment/i.test(a.label);
          const bBack = /back|rear|environment/i.test(b.label);
          return bBack - aBack;
        });
        setCameras(sorted);
      })
      .catch(() => setError('Impossible d\'accéder à la caméra.'));

    return () => {
      reader.reset();
    };
  }, []);

  useEffect(() => {
    if (!cameras.length || !videoRef.current) return;

    const reader = readerRef.current;
    const deviceId = cameras[camIndex]?.deviceId;

    reader.reset();
    reader.decodeFromVideoDevice(deviceId, videoRef.current, (result, err) => {
      if (result) {
        const text = result.getText().replace(/[-\s]/g, '');
        // Garder seulement EAN-13 / ISBN-13 ou ISBN-10
        if (/^\d{10}$/.test(text) || /^\d{13}$/.test(text)) {
          reader.reset();
          onDetected(text);
        }
      }
      if (err && !(err instanceof NotFoundException)) {
        // Erreur réelle (pas juste "pas encore de code détecté")
        console.warn('Scanner error:', err);
      }
    });
  }, [cameras, camIndex, onDetected]);

  const switchCamera = () => {
    setCamIndex(i => (i + 1) % cameras.length);
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

        {cameras.length > 1 && (
          <button className={styles.switchBtn} onClick={switchCamera}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
              <path d="M3 3v5h5"/>
            </svg>
            Changer de caméra
          </button>
        )}
      </div>
    </div>
  );
};

export default BarcodeScanner;