import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axiosAdmin from '../axiosAdmin';
import styles from '../styles/Navbar.module.css';

const BellIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
  </svg>
);

const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

const CATEGORIES = [
  { key: 'all',          label: 'Toutes',      adminOnly: false },
  { key: 'completed',    label: 'Disponible',  adminOnly: false },
  { key: 'canceled',     label: 'Annulé',      adminOnly: false },
  { key: 'adminComment', label: 'Message',      adminOnly: false },
  { key: 'reported',     label: 'Signalement', adminOnly: true  },
  { key: 'new_request',  label: 'Demandes',    adminOnly: true  },
  { key: 'userComment',  label: 'Messages',    adminOnly: true  },
  { key: 'update',       label: 'Mise à jour', adminOnly: true  },
];

const DASHBOARD_TYPES = new Set(['completed', 'canceled', 'adminComment', 'deleted', 'resolved']);
const ADMIN_TYPES     = new Set(['reported', 'new_request', 'userComment']);

const getNotificationText = (n) => {
  if (n.type === 'update')       return null; // handled separately
  if (n.standalone)              return n.notification.message;
  if (n.type === 'completed')    return `"${n.request.title}" est disponible au téléchargement`;
  if (n.type === 'canceled')     return `"${n.request.title}" a été annulée${n.request.cancelReason ? ` : ${n.request.cancelReason}` : ''}`;
  if (n.type === 'adminComment') {
    const lastAdminComment = n.request.comments?.filter(c => c.role === 'admin').slice(-1)[0];
    if (lastAdminComment) return `Nouveau message sur "${n.request.title}" : ${lastAdminComment.text}`;
    return `Note admin sur "${n.request.title}"${n.request.adminComment ? ` : ${n.request.adminComment}` : ''}`;
  }
  if (n.type === 'reported')     return `Signalement sur "${n.request.title}" (${n.request.username})${n.request.reportReason ? ` : ${n.request.reportReason}` : ''}`;
  if (n.type === 'userComment') {
    const lastUserComment = n.request.comments?.filter(c => c.role === 'user').slice(-1)[0];
    if (lastUserComment) return `Message de ${n.request.username || lastUserComment.author} sur "${n.request.title}" : ${lastUserComment.text}`;
    return `Nouveau message sur "${n.request.title}"`;
  }
  return n.request?.title ?? '';
};

const getNotificationIcon = (n) => {
  if (n.type === 'completed')    return '✅';
  if (n.type === 'canceled')     return '❌';
  if (n.type === 'reported')     return '⚠️';
  if (n.type === 'deleted')      return '🗑️';
  if (n.type === 'resolved')     return '✔️';
  if (n.type === 'new_request')  return '📚';
  if (n.type === 'userComment')  return '💬';
  if (n.type === 'update')       return '🔄';
  return '💬';
};

const NotificationBell = () => {
  const [notifications, setNotifications]     = useState([]);
  const [updateInfo, setUpdateInfo]           = useState(null);
  const [dismissedUpdate, setDismissedUpdate] = useState(
    () => localStorage.getItem('updateNotifDismissed') || ''
  );
  const [isOpen, setIsOpen]     = useState(false);
  const [category, setCategory] = useState('all');
  const [prevUnseen, setPrevUnseen] = useState(0);
  const dropdownRef = useRef(null);
  const navigate    = useNavigate();
  const isAdmin     = localStorage.getItem('role') === 'admin';

  const fetchNotifications = useCallback(async () => {
    let allNotifs   = [];
    let adminNotifs = [];

    try {
      const res = await axiosAdmin.get('/api/notifications/history');
      if (res.data.success) allNotifs = res.data.notifications;
    } catch {
      try {
        const res = await axiosAdmin.get('/api/notifications/unseen');
        if (res.data.success) allNotifs = res.data.notifications.map(n => ({ ...n, seen: false }));
      } catch {}
    }

    if (isAdmin) {
      try {
        const res = await axiosAdmin.get('/api/notifications/admin/unseen');
        if (res.data.success) adminNotifs = res.data.notifications.map(n => ({ ...n, seen: false }));
      } catch {}

      try {
        const res = await axiosAdmin.get('/api/admin/releases/update-check');
        if (res.data?.updateAvailable) setUpdateInfo(res.data);
      } catch {}
    }

    // Dédupliquer les notifs admin déjà présentes dans l'historique
    const adminKeys = new Set(adminNotifs.map(n =>
      n.standalone ? String(n.notification?._id) : `${n.request?._id}-${n.type}`
    ));
    const deduped = allNotifs.filter(n => {
      const key = n.standalone ? String(n.notification?._id) : `${n.request?._id}-${n.type}`;
      return !adminKeys.has(key);
    });

    setNotifications([...adminNotifs, ...deduped]);
  }, [isAdmin]);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  const unseenCount = notifications.filter(n => !n.seen).length
    + (updateInfo && dismissedUpdate !== updateInfo.latestVersion ? 1 : 0);

  useEffect(() => {
    document.title = unseenCount > 0 ? `(${unseenCount}) EbookRequest` : 'EbookRequest';
    setPrevUnseen(unseenCount);
  }, [unseenCount]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // ─── Marquer comme lu ────────────────────────────────────────────────────
  const markAsSeen = async (n, e) => {
    if (e) e.stopPropagation();
    if (n.seen) return;
    try {
      if (n.standalone) {
        await axiosAdmin.post(`/api/notifications/standalone/${n.notification._id}/seen`);
      } else if (n.type === 'reported') {
        await axiosAdmin.post(`/api/notifications/admin/${n.request._id}/seen`);
      } else {
        await axiosAdmin.post(`/api/notifications/${n.request._id}/seen`, { type: n.type });
      }
      setNotifications(prev =>
        prev.map(x => x === n ? { ...x, seen: true } : x)
      );
    } catch (err) {
      console.error('Erreur marquage:', err);
    }
  };

  const markAllAsSeen = () => {
    notifications.filter(n => !n.seen).forEach(n => markAsSeen(n));
    if (updateInfo && dismissedUpdate !== updateInfo.latestVersion) {
      localStorage.setItem('updateNotifDismissed', updateInfo.latestVersion);
      setDismissedUpdate(updateInfo.latestVersion);
    }
  };

  const handleClick = async (n) => {
    await markAsSeen(n);
    setIsOpen(false);
    const id = n.request?._id;
    if (ADMIN_TYPES.has(n.type)) {
      navigate(id ? `/admin?tab=requests&highlight=${id}` : '/admin');
    } else if (DASHBOARD_TYPES.has(n.type)) {
      navigate(id ? `/dashboard?highlight=${id}` : '/dashboard');
    }
  };

  // ─── Filtrage par catégorie ───────────────────────────────────────────────
  const showUpdateNotif = isAdmin && updateInfo && dismissedUpdate !== updateInfo.latestVersion;

  const filtered = notifications.filter(n =>
    category === 'all' || n.type === category
  );

  const visibleCategories = CATEGORIES.filter(c => {
    if (c.adminOnly && !isAdmin) return false;
    if (c.key === 'all')    return true;
    if (c.key === 'update') return showUpdateNotif;
    return notifications.some(n => n.type === c.key);
  });

  const isNew = unseenCount > prevUnseen;

  return (
    <div className={styles.bellWrapper} ref={dropdownRef}>
      <button className={styles.bellButton} onClick={() => setIsOpen(o => !o)} aria-label="Notifications">
        <BellIcon />
        {unseenCount > 0 && (
          <span className={`${styles.bellBadge} ${isNew ? styles.bellBadgePulse : ''}`}>
            {unseenCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className={styles.bellDropdown}>

          {/* Header */}
          <div className={styles.bellDropdownHeader}>
            <span>Notifications</span>
            {(notifications.some(n => !n.seen) || showUpdateNotif) && (
              <button className={styles.bellClearAll} onClick={markAllAsSeen}>
                Tout marquer comme lu
              </button>
            )}
          </div>

          {/* Filtres catégories */}
          {visibleCategories.length > 1 && (
            <div className={styles.bellCategories}>
              {visibleCategories.map(c => (
                <button
                  key={c.key}
                  className={`${styles.bellCategoryChip} ${category === c.key ? styles.bellCategoryActive : ''}`}
                  onClick={() => setCategory(c.key)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}

          {/* Notif mise à jour */}
          {(category === 'all' || category === 'update') && showUpdateNotif && (
            <div
              className={`${styles.bellItem} ${styles.bellItemUnread}`}
              onClick={() => {
                localStorage.setItem('updateNotifDismissed', updateInfo.latestVersion);
                setDismissedUpdate(updateInfo.latestVersion);
                setIsOpen(false);
                navigate('/admin?tab=updates');
              }}
            >
              <span className={styles.bellItemIcon}>🔄</span>
              <span className={styles.bellItemText}>
                Mise à jour disponible —{' '}
                <strong>{updateInfo.releaseName || `v${updateInfo.latestVersion}`}</strong>
                {' '}(v{updateInfo.currentVersion} installée)
              </span>
              <button
                className={styles.bellMarkRead}
                title="Marquer comme lu"
                onClick={(e) => {
                  e.stopPropagation();
                  localStorage.setItem('updateNotifDismissed', updateInfo.latestVersion);
                  setDismissedUpdate(updateInfo.latestVersion);
                }}
              >
                <CheckIcon />
              </button>
            </div>
          )}

          {/* Liste */}
          {filtered.length === 0 && !showUpdateNotif ? (
            <div className={styles.bellEmpty}>
              {category === 'all' ? 'Aucune notification' : 'Aucune notification dans cette catégorie'}
            </div>
          ) : filtered.length > 0 ? (
            <ul className={styles.bellList}>
              {filtered.map((n) => (
                <li
                  key={n.standalone ? n.notification._id : `${n.request._id}-${n.type}`}
                  className={`${styles.bellItem} ${!n.seen ? styles.bellItemUnread : styles.bellItemRead}`}
                  onClick={() => handleClick(n)}
                >
                  <span className={styles.bellItemIcon}>{getNotificationIcon(n)}</span>
                  <span className={styles.bellItemText}>{getNotificationText(n)}</span>
                  {!n.seen && (
                    <button
                      className={styles.bellMarkRead}
                      onClick={(e) => markAsSeen(n, e)}
                      title="Marquer comme lu"
                    >
                      <CheckIcon />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : null}

        </div>
      )}
    </div>
  );
};

export default NotificationBell;