import React, { useEffect, useState } from 'react';
import axiosAdmin from '../../axiosAdmin';
import styles from './ProfilePage.module.css';

const getAvatarColor = (username = '') => {
  const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#14b8a6'];
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
};

const ProfilePage = () => {
  const [data, setData] = useState(null);
  const [reading, setReading] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      axiosAdmin.get('/api/users/me/stats'),
      axiosAdmin.get('/api/reading?status=all'),
    ])
      .then(([statsRes, readingRes]) => {
        setData(statsRes.data);
        const books = readingRes.data || [];
        const readCount = books.filter(b => b.status === 'read').length;
        setReading({
          total: books.length,
          read: readCount,
          unread: books.length - readCount,
          rate: books.length > 0 ? Math.round((readCount / books.length) * 100) : 0,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className={styles.loading}>
      <div className={styles.spinner} />
    </div>
  );

  if (!data) return null;

  const { user, stats } = data;
  const memberSince = new Date(user.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });

  const statCards = [
    {
      label: 'Demandes totales', value: stats.total, color: '#4f8cff',
      icon: <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>,
    },
    {
      label: 'Complétées', value: stats.completed, color: '#10b981',
      icon: <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>,
    },
    {
      label: 'En attente', value: stats.pending, color: '#f59e0b',
      icon: <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>,
    },
    {
      label: 'Annulées', value: stats.canceled, color: '#ef4444',
      icon: <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>,
    },
    {
      label: 'Téléchargées', value: stats.downloaded, color: '#8b5cf6',
      icon: <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
    },
    {
      label: 'Taux de complétion', value: `${stats.completionRate}%`, color: '#14b8a6',
      icon: <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
    },
  ];

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.avatarBlock}>
          {user.avatar ? (
            <img src={user.avatar} alt={user.username} className={styles.avatar} />
          ) : (
            <div className={styles.avatarLetter} style={{ background: getAvatarColor(user.username) }}>
              {user.username[0]?.toUpperCase()}
            </div>
          )}
          <div className={styles.userInfo}>
            <h1 className={styles.username}>{user.username}</h1>
            <span className={styles.role}>{user.role === 'admin' ? '⚡ Administrateur' : '👤 Utilisateur'}</span>
            <span className={styles.since}>Membre depuis {memberSince}</span>
          </div>
        </div>
      </div>

      <h2 className={styles.sectionTitle}>Statistiques</h2>

      <div className={styles.statsGrid}>
        {statCards.map(s => (
          <div key={s.label} className={styles.statCard}>
            <div className={styles.statIcon} style={{ color: s.color }}>{s.icon}</div>
            <div className={styles.statValue} style={{ color: s.color }}>{s.value}</div>
            <div className={styles.statLabel}>{s.label}</div>
          </div>
        ))}
      </div>

      {stats.total > 0 && (
        <div className={styles.progressCard}>
          <div className={styles.progressHeader}>
            <span>Taux de complétion</span>
            <span>{stats.completionRate}%</span>
          </div>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${stats.completionRate}%` }} />
          </div>
        </div>
      )}

      {reading && reading.total > 0 && (
        <>
          <h2 className={styles.sectionTitle} style={{ marginTop: '2rem' }}>Bibliothèque</h2>
          <div className={styles.readingGrid}>
            <div className={styles.statCard}>
              <div className={styles.statIcon} style={{ color: '#6366f1' }}>
                <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                </svg>
              </div>
              <div className={styles.statValue} style={{ color: '#6366f1' }}>{reading.total}</div>
              <div className={styles.statLabel}>livre{reading.total > 1 ? 's' : ''} au total</div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statIcon} style={{ color: '#10b981' }}>
                <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <div className={styles.statValue} style={{ color: '#10b981' }}>{reading.read}</div>
              <div className={styles.statLabel}>lu{reading.read > 1 ? 's' : ''}</div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statIcon} style={{ color: '#f59e0b' }}>
                <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                </svg>
              </div>
              <div className={styles.statValue} style={{ color: '#f59e0b' }}>{reading.unread}</div>
              <div className={styles.statLabel}>non lu{reading.unread > 1 ? 's' : ''}</div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statIcon} style={{ color: '#14b8a6' }}>
                <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
                </svg>
              </div>
              <div className={styles.statValue} style={{ color: '#14b8a6' }}>{reading.rate}%</div>
              <div className={styles.statLabel}>progression</div>
            </div>
          </div>
          <div className={styles.progressCard}>
            <div className={styles.progressHeader}>
              <span>Livres lus</span>
              <span>{reading.read} / {reading.total}</span>
            </div>
            <div className={styles.progressBar}>
              <div className={styles.progressFillGreen} style={{ width: `${reading.rate}%` }} />
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ProfilePage;