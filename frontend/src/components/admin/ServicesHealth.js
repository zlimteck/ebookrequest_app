import React, { useEffect, useState, useCallback } from 'react';
import axiosAdmin from '../../axiosAdmin';
import styles from './ServicesHealth.module.css';

const SERVICE_DEFS = [
  {
    key: 'aiProvider',
    label: (s) => s.provider ? ({ openai: 'OpenAI', ollama: 'Ollama' }[s.provider] || s.provider) : 'IA',
    icon: (
      <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/>
        <path d="M15 2v2M9 2v2M15 20v2M9 20v2M2 15h2M2 9h2M20 15h2M20 9h2"/>
      </svg>
    ),
    isEnabled: () => true,
    isConnected: (s) => s.connected,
    details: (s) => {
      const lines = [];
      if (s.model) lines.push(`Modèle : ${s.model}`);
      if (s.provider === 'ollama' && s.modelAvailable != null)
        lines.push(s.modelAvailable ? '✓ Modèle disponible' : '⚠ Modèle non disponible');
      return lines;
    },
    error: (s) => s.error,
  },
  {
    key: 'flareSolverr',
    label: () => 'FlareSolverr',
    icon: (
      <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
    ),
    isEnabled: () => true,
    isConnected: (s) => s.connected,
    details: (s) => s.version ? [`Version : ${s.version}`] : [],
    error: (s) => s.error,
  },
  {
    key: 'apprise',
    label: () => 'Apprise',
    icon: (
      <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
      </svg>
    ),
    isEnabled: () => true,
    isConnected: (s) => s.reachable,
    details: () => [],
    error: (s) => s.error,
  },
  {
    key: 'calibreWeb',
    label: () => 'Calibre-Web',
    icon: (
      <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
      </svg>
    ),
    isEnabled: (s) => s.enabled,
    isConnected: (s) => s.connected,
    details: (s) => s.url ? [`URL : ${s.url}`] : [],
    error: (s) => s.error,
  },
  {
    key: 'valentine',
    label: () => 'Valentine.wtf',
    icon: (
      <img
        src="https://valentine.wtf/logo.php?mode=clair"
        alt="Valentine"
        className={styles.valentineIcon}
      />
    ),
    isEnabled: (s) => s.enabled,
    isConnected: (s) => s.connected,
    details: (s) => {
      if (!s.quota) return [];
      const remaining = s.quota.remaining ?? '—';
      const total = s.quota.total != null ? ` / ${s.quota.total}` : '';
      return [`Quota : ${remaining}${total} téléch. restants`];
    },
    error: (s) => s.error,
  },
  {
    key: 'annasArchive',
    label: () => "Anna's Archive",
    icon: (
      <span style={{ fontSize: '1.2rem', fontWeight: 900, fontFamily: "'Arial Black', Arial, Helvetica, sans-serif", color: 'var(--color-text-muted)', lineHeight: 1, letterSpacing: '-0.03em', width: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>A</span>
    ),
    isEnabled: (s) => s.enabled,
    isConnected: (s) => s.connected,
    details: () => [],
    error: (s) => s.error,
  },
  {
    key: 'mcp',
    label: () => 'Serveur MCP',
    icon: (
      <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
      </svg>
    ),
    isEnabled: (s) => s.enabled,
    isConnected: (s) => s.connected,
    details: (s) => s.url ? [`URL : ${s.url}`] : [],
    error: (s) => s.error,
  },
];

const formatCheckedAt = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const ServicesHealth = () => {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const fetchHealth = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await axiosAdmin.get('/api/admin/health');
      setHealth(res.data);
    } catch (err) {
      setError('Impossible de récupérer l\'état des services.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchHealth(); }, [fetchHealth]);

  if (loading) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.spinner}></div>
        <p>Vérification des services en cours…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.errorBox}>
        <p>{error}</p>
        <button className={styles.refreshBtn} onClick={() => fetchHealth(true)}>Réessayer</button>
      </div>
    );
  }

  const services = health?.services || {};

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h2 className={styles.title}>Santé des services</h2>
          {health?.checkedAt && (
            <span className={styles.checkedAt}>Dernière vérification à {formatCheckedAt(health.checkedAt)}</span>
          )}
        </div>
        <button
          className={styles.refreshBtn}
          onClick={() => fetchHealth(true)}
          disabled={refreshing}
          title="Rafraîchir"
        >
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
            style={{ animation: refreshing ? 'spin 0.8s linear infinite' : 'none' }}>
            <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
          </svg>
        </button>
      </div>

      <div className={styles.grid}>
        {SERVICE_DEFS.map((def) => {
          const s = services[def.key];
          if (!s) return null;
          const enabled = def.isEnabled(s);
          const connected = enabled && def.isConnected(s);
          const details = def.details(s);
          const err = def.error(s);
          const label = typeof def.label === 'function' ? def.label(s) : def.label;

          return (
            <div key={def.key} className={`${styles.card} ${!enabled ? styles.cardDisabled : ''}`}>
              <div className={styles.cardIcon}>{def.icon}</div>
              <div className={styles.cardBody}>
                <div className={styles.cardTop}>
                  <span className={styles.cardName}>{label}</span>
                  <span className={styles.dotWrap}>
                    {connected && <span className={styles.dotPing} />}
                    <span className={`${styles.dot} ${!enabled ? styles.dotDisabled : connected ? styles.dotOk : styles.dotError}`} />
                  </span>
                </div>
                {details.length > 0 && (
                  <ul className={styles.details}>
                    {details.map((d, i) => <li key={i}>{d}</li>)}
                  </ul>
                )}
                {err && <p className={styles.cardError}>{err.length > 120 ? err.slice(0, 120) + '…' : err}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ServicesHealth;