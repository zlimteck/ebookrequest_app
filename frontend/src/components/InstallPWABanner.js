import React, { useEffect, useState } from 'react';
import styles from './InstallPWABanner.module.css';

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const isInStandaloneMode = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true;

const InstallPWABanner = () => {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [show, setShow] = useState(false);
  const [platform, setPlatform] = useState(null); // 'android' | 'ios'

  useEffect(() => {
    if (isInStandaloneMode()) return;
    if (localStorage.getItem('pwa-banner-dismissed')) return;

    const isMobile = /android|iphone|ipad|ipod/i.test(navigator.userAgent);
    if (!isMobile) return;

    if (isIOS()) {
      setPlatform('ios');
      setShow(true);
      return;
    }

    // Événement déjà capturé avant le montage du composant
    if (window.__pwaInstallPrompt) {
      setDeferredPrompt(window.__pwaInstallPrompt);
      setPlatform('android');
      setShow(true);
      return;
    }

    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setPlatform('android');
      setShow(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') dismiss();
    setDeferredPrompt(null);
  };

  const dismiss = () => {
    setShow(false);
    localStorage.setItem('pwa-banner-dismissed', '1');
  };

  if (!show) return null;

  return (
    <div className={styles.banner}>
      <img src="/img/logo.png" alt="logo" className={styles.logo} />
      <div className={styles.text}>
        {platform === 'ios' ? (
          <>
            <strong>Installer l'application</strong>
            <span>
              Appuie sur{' '}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', margin: '0 2px' }}>
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                <polyline points="16 6 12 2 8 6"/>
                <line x1="12" y1="2" x2="12" y2="15"/>
              </svg>
              puis <em>"Sur l'écran d'accueil"</em>
            </span>
          </>
        ) : (
          <>
            <strong>Installer l'application</strong>
            <span>Accès rapide depuis votre écran d'accueil</span>
          </>
        )}
      </div>
      <div className={styles.actions}>
        {platform === 'android' && (
          <button className={styles.installBtn} onClick={handleInstall}>Installer</button>
        )}
        <button className={styles.dismissBtn} onClick={dismiss} aria-label="Fermer">✕</button>
      </div>
    </div>
  );
};

export default InstallPWABanner;
