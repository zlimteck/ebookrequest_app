import React, { useEffect, useState, useCallback } from 'react';
import axiosAdmin from '../../axiosAdmin';
import styles from './EmailLogsPanel.module.css';

const PER_PAGE = 50;

const STATUS_META = {
  sent:       { label: 'Envoyé',    color: '#6366f1' },
  delivered:  { label: 'Livré',     color: '#10b981' },
  opened:     { label: 'Ouvert',    color: '#3b82f6' },
  clicked:    { label: 'Cliqué',    color: '#06b6d4' },
  bounced:    { label: 'Rejeté',    color: '#ef4444' },
  complained: { label: 'Spam',      color: '#f59e0b' },
  failed:     { label: 'Échec',     color: '#dc2626' },
};

const TYPE_LABELS = {
  verification:    'Vérification',
  password_reset:  'Réinit. mot de passe',
  password_changed:'Mdp modifié',
  book_completed:  'Livre complété',
  book_canceled:   'Livre annulé',
  admin_comment:   'Note admin',
  new_request:     'Nouvelle demande',
  broadcast:       'Diffusion',
  invitation:      'Invitation',
};

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || { label: status, color: '#94a3b8' };
  return (
    <span
      className={styles.badge}
      style={{ background: `${meta.color}1a`, color: meta.color, borderColor: `${meta.color}40` }}
    >
      {meta.label}
    </span>
  );
}

export default function EmailLogsPanel() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType]     = useState('');
  const [search, setSearch]             = useState('');
  const [searchInput, setSearchInput]   = useState('');

  const [stats, setStats] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page, limit: PER_PAGE });
      if (filterStatus) params.set('status', filterStatus);
      if (filterType)   params.set('type',   filterType);
      if (search)       params.set('search', search);

      const res = await axiosAdmin.get(`/api/admin/email-logs?${params}`);
      setLogs(res.data.logs);
      setTotal(res.data.total);
      setPages(res.data.pages);
    } catch {
      setError('Impossible de charger les logs.');
    } finally {
      setLoading(false);
    }
  }, [page, filterStatus, filterType, search]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await axiosAdmin.get('/api/admin/email-logs/stats');
      setStats(res.data);
    } catch {
      // silencieux
    }
  }, []);

  useEffect(() => {
    fetchLogs();
    fetchStats();
  }, [fetchLogs, fetchStats]);

  // Réinitialiser la page quand les filtres changent
  useEffect(() => {
    setPage(1);
  }, [filterStatus, filterType, search]);

  const handleSearch = (e) => {
    e.preventDefault();
    setSearch(searchInput);
  };

  const getStatCount = (arr, key, val) => {
    const found = arr?.find(x => x._id === val);
    return found?.count ?? 0;
  };

  return (
    <div className={styles.wrap}>
      {/* Stats 30j */}
      {stats && (
        <div className={styles.statsRow}>
          {Object.entries(STATUS_META).map(([key, meta]) => {
            const count = getStatCount(stats.byStatus, '_id', key);
            return (
              <button
                key={key}
                className={`${styles.statCard} ${filterStatus === key ? styles.statCardActive : ''}`}
                style={{ '--accent': meta.color }}
                onClick={() => setFilterStatus(prev => prev === key ? '' : key)}
              >
                <span className={styles.statCount}>{count}</span>
                <span className={styles.statLabel}>{meta.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Filtres */}
      <div className={styles.filtersRow}>
        <form onSubmit={handleSearch} className={styles.searchForm}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Destinataire, sujet…"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
          />
          <button type="submit" className={styles.searchBtn}>
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
          </button>
        </form>

        <select
          className={styles.select}
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
        >
          <option value="">Tous les types</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

        <button className={styles.resetBtn} onClick={() => {
          setFilterStatus('');
          setFilterType('');
          setSearch('');
          setSearchInput('');
        }}>
          Réinitialiser
        </button>

        <button className={styles.refreshBtn} onClick={() => { fetchLogs(); fetchStats(); }}>
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10"/>
            <polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
        </button>
      </div>

      <div className={styles.totalInfo}>
        {total} email{total !== 1 ? 's' : ''}
        {(filterStatus || filterType || search) ? ' (filtré)' : ' (30 derniers jours)'}
      </div>

      {/* Tableau */}
      {loading ? (
        <div className={styles.loader}><div className={styles.spinner} /></div>
      ) : error ? (
        <p className={styles.errorMsg}>{error}</p>
      ) : logs.length === 0 ? (
        <p className={styles.empty}>Aucun email trouvé.</p>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Destinataire</th>
                <th>Sujet</th>
                <th>Type</th>
                <th>Statut</th>
                <th>Provider</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => (
                <React.Fragment key={log._id}>
                  <tr
                    className={`${styles.row} ${expanded === log._id ? styles.rowExpanded : ''}`}
                    onClick={() => setExpanded(prev => prev === log._id ? null : log._id)}
                  >
                    <td className={styles.colDate}>
                      {new Date(log.sentAt).toLocaleDateString('fr-FR', {
                        day: '2-digit', month: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className={styles.colTo}>{log.to}</td>
                    <td className={styles.colSubject}>{log.subject}</td>
                    <td>
                      <span className={styles.typePill}>
                        {TYPE_LABELS[log.type] || log.type}
                      </span>
                    </td>
                    <td><StatusBadge status={log.status} /></td>
                    <td>
                      <span className={`${styles.providerBadge} ${log.provider === 'resend' ? styles.providerResend : styles.providerSmtp}`}>
                        {log.provider}
                      </span>
                    </td>
                    <td className={styles.colExpand}>
                      <svg
                        width="12" height="12" fill="none" viewBox="0 0 24 24"
                        stroke="currentColor" strokeWidth="2.5"
                        style={{ transform: expanded === log._id ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
                      >
                        <polyline points="6 9 12 15 18 9"/>
                      </svg>
                    </td>
                  </tr>

                  {/* Ligne de détail déroulante */}
                  {expanded === log._id && (
                    <tr className={styles.detailRow}>
                      <td colSpan={7}>
                        <div className={styles.detailPanel}>
                          {log.emailId && (
                            <div className={styles.detailItem}>
                              <span className={styles.detailLabel}>ID Resend</span>
                              <span className={styles.detailValue} style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{log.emailId}</span>
                            </div>
                          )}
                          {log.error && (
                            <div className={styles.detailItem}>
                              <span className={styles.detailLabel}>Erreur</span>
                              <span className={styles.detailValue} style={{ color: '#ef4444' }}>{log.error}</span>
                            </div>
                          )}
                          {log.events?.length > 0 && (
                            <div className={styles.detailItem}>
                              <span className={styles.detailLabel}>Historique</span>
                              <div className={styles.eventList}>
                                {log.events.map((ev, i) => {
                                  const meta = STATUS_META[ev.type] || { label: ev.type, color: '#94a3b8' };
                                  return (
                                    <div key={i} className={styles.eventItem}>
                                      <span className={styles.eventDot} style={{ background: meta.color }} />
                                      <span style={{ color: meta.color, fontWeight: 600, fontSize: '0.8rem' }}>{meta.label}</span>
                                      <span className={styles.eventTime}>
                                        {new Date(ev.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                        {' '}
                                        {new Date(ev.timestamp).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}
                                      </span>
                                      {ev.data?.link && (
                                        <span className={styles.eventData}>→ {ev.data.link}</span>
                                      )}
                                      {ev.data?.reason && (
                                        <span className={styles.eventData} style={{ color: '#ef4444' }}>{ev.data.reason}</span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className={styles.pagination}>
          <button
            className={styles.pageBtn}
            onClick={() => setPage(p => p - 1)}
            disabled={page === 1}
          >
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
            Précédent
          </button>
          <span className={styles.pageInfo}>{page} / {pages}</span>
          <button
            className={styles.pageBtn}
            onClick={() => setPage(p => p + 1)}
            disabled={page === pages}
          >
            Suivant
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      )}
    </div>
  );
}