import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axiosAdmin from '../axiosAdmin';
import styles from '../styles/Navbar.module.css';

const BellIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
  </svg>
);

// Types qui redirigent vers /dashboard au clic
const DASHBOARD_TYPES = new Set(['completed', 'canceled', 'adminComment', 'deleted', 'resolved']);
// Types qui redirigent vers /admin au clic
const ADMIN_TYPES = new Set(['reported', 'new_request']);

const NotificationBell = () => {
  const [notifications, setNotifications] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [prevCount, setPrevCount] = useState(0);
  const dropdownRef = useRef(null);
  const navigate = useNavigate();

  const fetchNotifications = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    const isAdmin = localStorage.getItem('role') === 'admin';

    let userNotifs = [];
    let adminNotifs = [];

    try {
      const res = await axiosAdmin.get('/api/notifications/unseen');
      if (res.data.success) userNotifs = res.data.notifications;
    } catch (err) {
      console.error('Erreur fetch notifications user:', err.response?.status, err.message);
    }

    if (isAdmin) {
      try {
        const res = await axiosAdmin.get('/api/notifications/admin/unseen');
        if (res.data.success) adminNotifs = res.data.notifications;
      } catch (err) {
        console.error('Erreur fetch notifications admin:', err.response?.status, err.message);
      }
    }

    setNotifications([...userNotifs, ...adminNotifs]);
  };

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 10000);
    return () => clearInterval(interval);
  }, []);

  // Badge titre onglet
  useEffect(() => {
    const base = 'EbookRequest';
    document.title = notifications.length > 0 ? `(${notifications.length}) ${base}` : base;
    setPrevCount(notifications.length);
  }, [notifications]);

  // Fermeture au clic extérieur
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const dismissNotification = async (n) => {
    try {
      if (n.standalone) {
        await axiosAdmin.post(`/api/notifications/standalone/${n.notification._id}/seen`);
      } else if (n.type === 'reported') {
        await axiosAdmin.post(`/api/notifications/admin/${n.request._id}/seen`);
      } else {
        await axiosAdmin.post(`/api/notifications/${n.request._id}/seen`, { type: n.type });
      }
      setNotifications(prev => prev.filter(existing => existing !== n));
    } catch (err) {
      console.error('Erreur lors du marquage de la notification:', err);
    }
  };

  const handleNotificationClick = async (n) => {
    await dismissNotification(n);
    setIsOpen(false);
    if (ADMIN_TYPES.has(n.type)) {
      navigate('/admin');
    } else if (DASHBOARD_TYPES.has(n.type)) {
      navigate('/dashboard');
    }
  };

  const dismissAll = () => {
    notifications.forEach(n => dismissNotification(n));
  };

  const getNotificationText = (n) => {
    if (n.standalone) return n.notification.message;
    if (n.type === 'completed') return `"${n.request.title}" est disponible au téléchargement`;
    if (n.type === 'canceled') return `"${n.request.title}" a été annulée${n.request.cancelReason ? ` : ${n.request.cancelReason}` : ''}`;
    if (n.type === 'adminComment') return `Note admin sur "${n.request.title}" : ${n.request.adminComment}`;
    if (n.type === 'reported') return `Signalement sur "${n.request.title}" (${n.request.username})${n.request.reportReason ? ` : ${n.request.reportReason}` : ''}`;
    return n.request?.title ?? '';
  };

  const getNotificationIcon = (n) => {
    if (n.type === 'completed') return '✅';
    if (n.type === 'canceled') return '❌';
    if (n.type === 'reported') return '⚠️';
    if (n.type === 'deleted') return '🗑️';
    if (n.type === 'resolved') return '✔️';
    if (n.type === 'new_request') return '📚';
    return '💬';
  };

  const isNew = notifications.length > prevCount;

  return (
    <div className={styles.bellWrapper} ref={dropdownRef}>
      <button
        className={styles.bellButton}
        onClick={() => setIsOpen(o => !o)}
        aria-label="Notifications"
      >
        <BellIcon />
        {notifications.length > 0 && (
          <span className={`${styles.bellBadge} ${isNew ? styles.bellBadgePulse : ''}`}>
            {notifications.length}
          </span>
        )}
      </button>

      {isOpen && (
        <div className={styles.bellDropdown}>
          <div className={styles.bellDropdownHeader}>
            <span>Notifications</span>
            {notifications.length > 0 && (
              <button className={styles.bellClearAll} onClick={dismissAll}>
                Tout effacer
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <div className={styles.bellEmpty}>Aucune nouvelle notification</div>
          ) : (
            <ul className={styles.bellList}>
              {notifications.map((n) => (
                <li
                  key={n.standalone ? n.notification._id : `${n.request._id}-${n.type}`}
                  className={styles.bellItem}
                  onClick={() => handleNotificationClick(n)}
                  style={{ cursor: 'pointer' }}
                >
                  <span className={styles.bellItemIcon}>{getNotificationIcon(n)}</span>
                  <span className={styles.bellItemText}>{getNotificationText(n)}</span>
                  <button
                    className={styles.bellDismiss}
                    onClick={(e) => { e.stopPropagation(); dismissNotification(n); }}
                    title="Supprimer"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationBell;
