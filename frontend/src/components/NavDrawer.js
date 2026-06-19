import React, { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import styles from './NavDrawer.module.css';
import { getAvatarColor } from '../utils/avatarColor';
import pkg from '../../package.json';
const { version } = pkg;

const NAV_ITEMS = [
  {
    to: '/dashboard',
    label: 'Mes demandes',
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
        <rect x="9" y="3" width="6" height="4" rx="1"/>
        <path d="M9 12h6M9 16h4"/>
      </svg>
    ),
    exact: true,
  },
  {
    to: '/',
    label: 'Nouvelle demande',
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="9"/>
        <line x1="12" y1="8" x2="12" y2="16"/>
        <line x1="8" y1="12" x2="16" y2="12"/>
      </svg>
    ),
    exact: true,
  },
  {
    to: '/discover',
    label: 'Découvrir',
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="9"/>
        <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>
      </svg>
    ),
    exact: false,
  },
  {
    to: '/reading',
    label: 'Ma bibliothèque',
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
      </svg>
    ),
    exact: false,
  },
  {
    to: '/settings',
    label: 'Paramètres',
    icon: (
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    ),
    exact: false,
  },
];

const ADMIN_ITEM = {
  to: '/admin',
  label: 'Administration',
  icon: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
    </svg>
  ),
  exact: false,
};

const NavDrawer = ({ isOpen, onClose, isAdmin, avatar, username, role, onLogout }) => {
  const location = useLocation();
  const drawerRef = useRef(null);

  // Fermeture avec Escape
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    if (isOpen) document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  // Bloquer le scroll du body quand ouvert
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  const isActive = (item) => {
    if (item.exact) return location.pathname === item.to;
    return location.pathname.startsWith(item.to);
  };

  const navItems = isAdmin ? [...NAV_ITEMS, ADMIN_ITEM] : NAV_ITEMS;

  const color = getAvatarColor({ role, hasValentine: localStorage.getItem('hasValentine') === 'true' });

  return (
    <>
      {/* Overlay */}
      <div
        className={`${styles.overlay} ${isOpen ? styles.overlayVisible : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        ref={drawerRef}
        className={`${styles.drawer} ${isOpen ? styles.drawerOpen : ''}`}
        aria-label="Menu de navigation"
        role="dialog"
        aria-modal="true"
      >
        {/* Header du drawer */}
        <div className={styles.drawerHeader}>
          <div className={styles.drawerBrand}>
            <img src="/img/logo.png" alt="EbookRequest" className={styles.drawerBrandLogo} />
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Fermer le menu">
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Liens de navigation */}
        <nav className={styles.drawerNav}>
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={`${styles.drawerLink} ${isActive(item) ? styles.drawerLinkActive : ''}`}
              onClick={onClose}
            >
              <span className={styles.drawerLinkIcon}>{item.icon}</span>
              <span>{item.label}</span>
              {isActive(item) && (
                <span className={styles.drawerLinkDot} />
              )}
            </Link>
          ))}
        </nav>

        {/* Barre basse : profil + déconnexion */}
        <div className={styles.drawerDivider} />
        <div className={styles.drawerFooter}>
          <div className={styles.drawerProfile}>
            <div className={styles.drawerAvatar}>
              {avatar ? (
                <img src={avatar} alt={username} className={styles.drawerAvatarImg} />
              ) : (
                <span className={styles.drawerAvatarLetter} style={{ background: color }}>
                  {(username || '?')[0].toUpperCase()}
                </span>
              )}
            </div>
            <div className={styles.drawerProfileInfo}>
              <span className={styles.drawerUsername}>{username}</span>
              <span className={styles.drawerRole}>{role === 'admin' ? 'Administrateur' : 'Utilisateur'}</span>
            </div>
          </div>

          <button
            className={styles.drawerLogoutIcon}
            onClick={() => { onClose(); onLogout(); }}
            title="Déconnexion"
          >
            <svg width="17" height="17" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>

        <div className={styles.drawerVersion}>
          <span>v{version}</span>
          <a
            href="https://github.com/zlimteck/ebookrequest_app"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.drawerGithub}
            title="GitHub"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
            </svg>
          </a>
        </div>
      </aside>
    </>
  );
};

export default NavDrawer;
