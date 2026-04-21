import React, { useEffect, useState, useCallback } from 'react';
import axiosAdmin from '../../axiosAdmin';
import styles from './OPDSPanel.module.css';

export default function OPDSPanel() {
  const [stats, setStats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await axiosAdmin.get('/api/admin/opds/stats');
      if (res.data.success) setStats(res.data.stats);
    } catch {
      setError('Impossible de charger les statistiques OPDS.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Catalogue OPDS</h2>
          <p className={styles.subtitle}>Utilisateurs ayant accédé à leur catalogue depuis une liseuse</p>
        </div>
        <button className={styles.refreshBtn} onClick={fetchStats} disabled={loading}>
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10"/>
            <polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
          Rafraîchir
        </button>
      </div>

      {loading ? (
        <div className={styles.loader}><div className={styles.spinner} /></div>
      ) : error ? (
        <p className={styles.errorMsg}>{error}</p>
      ) : stats.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>
            <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
            </svg>
          </div>
          <p className={styles.emptyText}>Aucun utilisateur n'a encore utilisé OPDS.</p>
        </div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Utilisateur</th>
                <th>Dernière visite</th>
                <th className={styles.colCount}>Consultations</th>
                <th className={styles.colCount}>Téléchargements</th>
                <th>Clients</th>
              </tr>
            </thead>
            <tbody>
              {stats.map(row => (
                <tr key={row.userId}>
                  <td className={styles.colUser}>{row.username}</td>
                  <td className={styles.colDate}>{formatDate(row.lastAccess)}</td>
                  <td className={styles.colCount}>{row.catalogCount}</td>
                  <td className={styles.colCount}>{row.downloadCount}</td>
                  <td>
                    {row.clients.length > 0
                      ? row.clients.map(c => (
                          <span key={c} className={styles.clientBadge}>{c}</span>
                        ))
                      : <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>—</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}