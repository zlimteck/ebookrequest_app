import React, { useEffect, useState, useCallback } from 'react';
import axiosAdmin from '../../axiosAdmin';
import styles from './DownloadLogs.module.css';

const CONNECTOR_LABELS = {
  valentine: 'Valentine',
  annasarchive: "Anna's Archive",
  manual: 'Manuel',
};

const CONNECTOR_CHIP_CLASS = {
  valentine: 'chipValentine',
  annasarchive: 'chipAnnas',
  manual: 'chipManual',
};

const formatDate = (iso) => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
};

const DownloadLogs = () => {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filterConnector, setFilterConnector] = useState('');
  const [filterSuccess, setFilterSuccess] = useState('');
  const [expandedError, setExpandedError] = useState(null);

  const fetchLogs = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const params = { page: p, limit: 50 };
      if (filterConnector) params.connector = filterConnector;
      if (filterSuccess !== '') params.success = filterSuccess;
      const res = await axiosAdmin.get('/api/admin/download-logs', { params });
      setLogs(res.data.logs);
      setTotal(res.data.total);
      setPage(res.data.page);
      setPages(res.data.pages);
    } catch {
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [filterConnector, filterSuccess]);

  useEffect(() => { fetchLogs(1); }, [fetchLogs]);

  return (
    <div className={styles.container}>
      <div className={styles.filters}>
        <select className={styles.select} value={filterConnector} onChange={e => setFilterConnector(e.target.value)}>
          <option value="">Tous les connecteurs</option>
          <option value="valentine">Valentine</option>
          <option value="annasarchive">Anna's Archive</option>
        </select>
        <select className={styles.select} value={filterSuccess} onChange={e => setFilterSuccess(e.target.value)}>
          <option value="">Tous les résultats</option>
          <option value="true">Succès</option>
          <option value="false">Échec</option>
        </select>
        <button className={styles.refreshBtn} onClick={() => fetchLogs(page)} title="Rafraîchir">
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
        </button>
      </div>

      {loading ? (
        <div className={styles.loading}>
          <div className={styles.spinner}></div>
          <span>Chargement…</span>
        </div>
      ) : logs.length === 0 ? (
        <div className={styles.empty}>
          <svg width="36" height="36" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.3" style={{ opacity: 0.3 }}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          <span>Aucun téléchargement enregistré</span>
        </div>
      ) : (
        <>
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Titre</th>
                  <th>Utilisateur</th>
                  <th>Connecteur</th>
                  <th>Déclencheur</th>
                  <th>Résultat</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <React.Fragment key={log._id}>
                    <tr
                      className={log.error ? styles.rowClickable : ''}
                      onClick={() => log.error && setExpandedError(expandedError === log._id ? null : log._id)}
                    >
                      <td className={styles.tdDate}>{formatDate(log.createdAt)}</td>
                      <td className={styles.tdTitle}>
                        <span className={styles.bookTitle}>{log.title || '—'}</span>
                        {log.author && <span className={styles.bookAuthor}>{log.author}</span>}
                      </td>
                      <td className={styles.tdUser}>{log.username || '—'}</td>
                      <td>
                        <span className={`${styles.chip} ${styles[CONNECTOR_CHIP_CLASS[log.connector] || 'chipManual']}`}>
                          {CONNECTOR_LABELS[log.connector] || log.connector}
                        </span>
                      </td>
                      <td>
                        <span className={`${styles.chip} ${log.triggeredBy === 'admin' ? styles.chipAdmin : styles.chipAuto}`}>
                          {log.triggeredBy === 'admin' ? 'Manuel' : 'Auto'}
                        </span>
                      </td>
                      <td>
                        <span className={`${styles.chip} ${log.success ? styles.chipOk : styles.chipFail}`}>
                          {log.success ? '✓ Succès' : '✗ Échec'}
                          {log.error && <span className={styles.errorArrow}>{expandedError === log._id ? ' ▲' : ' ▼'}</span>}
                        </span>
                      </td>
                    </tr>
                    {expandedError === log._id && log.error && (
                      <tr className={styles.errorRow}>
                        <td colSpan={6}>
                          <p className={styles.errorText}>{log.error}</p>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <div className={styles.pagination}>
              <button className={styles.pageBtn} disabled={page <= 1} onClick={() => fetchLogs(page - 1)}>← Précédent</button>
              <span className={styles.pageInfo}>Page {page} / {pages}</span>
              <button className={styles.pageBtn} disabled={page >= pages} onClick={() => fetchLogs(page + 1)}>Suivant →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default DownloadLogs;