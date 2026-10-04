import React, { useEffect, useState, useCallback } from 'react';
import axiosAdmin from '../../axiosAdmin';
import styles from './ServicesHealth.module.css';
import { useSocketStatus } from '../../hooks/useSocket';
import { OpenAIIcon, ClaudeIcon, OllamaIcon, GoogleIcon } from './brandIcons';
import hardcoverLogoMono from '../../assets/icons/hardcover-mono.png';

const AI_PROVIDER_ICONS = { openai: OpenAIIcon, claude: ClaudeIcon, ollama: OllamaIcon };

const SERVICE_DEFS = [
  {
    key: 'aiProvider',
    label: (s) => s.provider ? ({ openai: 'OpenAI', claude: 'Claude', ollama: 'Ollama' }[s.provider] || s.provider) : 'IA',
    icon: (s) => {
      const BrandIcon = AI_PROVIDER_ICONS[s.provider];
      if (!BrandIcon) {
        return (
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/>
            <path d="M15 2v2M9 2v2M15 20v2M9 20v2M2 15h2M2 9h2M20 15h2M20 9h2"/>
          </svg>
        );
      }
      return <BrandIcon size={20} />;
    },
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
    key: 'googleBooks',
    label: () => 'Google Books',
    icon: <GoogleIcon size={20} />,
    isEnabled: (s) => s.enabled,
    isConnected: (s) => s.connected,
    details: (s) => s.connected && s.totalItems != null ? [`Résultats trouvés (test) : ${s.totalItems}`] : [],
    error: (s) => s.error,
  },
  {
    key: 'hardcover',
    label: () => 'Hardcover',
    icon: <img src={hardcoverLogoMono} alt="" width={22} height={22} className={styles.cardIconImg} />,
    isEnabled: (s) => s.enabled,
    isConnected: (s) => s.connected,
    details: (s) => {
      const lines = [];
      if (s.username) lines.push(`Connecté : @${s.username}`);
      if (s.quota) lines.push(`Quota : ${s.quota.used}/${s.quota.limit} requêtes/min`);
      return lines;
    },
    error: (s) => s.error,
    hideIfDisabled: true,
  },
  {
    key: 'proxy',
    label: () => 'Proxy sortant',
    icon: (
      <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
    ),
    isEnabled: (s) => s.enabled,
    isConnected: (s) => s.connected,
    hideIfDisabled: true,
    details: (s) => {
      const lines = [];
      if (s.mode) lines.push(`Mode : ${s.mode === 'default' ? 'par défaut' : 'repli'}`);
      if (s.exitIp) lines.push(`IP de sortie : ${s.exitIp}`);
      return lines;
    },
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
    isConnected: (s) => s.connected && !s.circuitBreaker?.open,
    isWarning: (s) => !!s.circuitBreaker?.open,
    details: (s) => {
      const lines = [];
      if (s.quota) {
        const remaining = s.quota.remaining ?? '—';
        const total = s.quota.total != null ? ` / ${s.quota.total}` : '';
        lines.push(`Quota : ${remaining}${total} téléch. restants`);
      }
      if (!s.circuitBreaker?.open) {
        lines.push('Protection anti-blocage : opérationnelle');
      }
      return lines;
    },
    warning: (s) => {
      if (!s.circuitBreaker?.open) return null;
      const until = formatShortDateTime(s.circuitBreaker.blockedUntil);
      return `Blocages répétés détectés (${s.circuitBreaker.consecutiveBlocks}) — connecteur en pause${until ? ` jusqu'à ${until}` : ''}`;
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
    // Joignable mais /search bloqué par DDoS-Guard : le connecteur répond, mais recherche
    // et téléchargement automatique sont hors service — un statut « connecté » seul serait
    // trompeur.
    isWarning: (s) => s.connected && s.searchable === false,
    details: (s) => (s.connected && s.searchable ? ['Recherche opérationnelle'] : []),
    warning: (s) => (s.connected && s.searchable === false
      ? 'Protection anti-bot active — recherche et téléchargement automatique indisponibles. LibGen prend le relais s\'il est activé.'
      : null),
    error: (s) => s.error,
  },
  {
    key: 'fourtoutici',
    label: () => 'Fourtoutici',
    icon: (
      <span style={{ fontSize: '1.2rem', fontWeight: 900, fontFamily: "'Arial Black', Arial, Helvetica, sans-serif", color: 'var(--color-text-muted)', lineHeight: 1, letterSpacing: '-0.03em', width: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>F</span>
    ),
    isEnabled: (s) => s.enabled,
    isConnected: (s) => s.connected,
    hideIfDisabled: true,
    details: (s) => s.url ? [`URL : ${s.url}`] : [],
    error: (s) => s.error,
  },
  {
    key: 'ultimZone',
    label: () => 'Ultim-Zone',
    icon: (
      <span style={{ fontSize: '1.2rem', fontWeight: 900, fontFamily: "'Arial Black', Arial, Helvetica, sans-serif", color: 'var(--color-text-muted)', lineHeight: 1, letterSpacing: '-0.03em', width: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>U</span>
    ),
    isEnabled: (s) => s.enabled,
    isConnected: (s) => s.connected,
    hideIfDisabled: true,
    details: (s) => s.url ? [`URL : ${s.url}`] : [],
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

const formatShortDateTime = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
};

const formatCheckedAt = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const WS_ICON = (
  <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/>
    <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/>
  </svg>
);

const ServicesHealth = () => {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const wsConnected = useSocketStatus();

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

  // Chemin de recherche réellement observé lors de ce check (pas juste ce qui est
  // configuré) : combine activation ET connectivité, pour repérer un maillon activé
  // mais en échec (ex. clé invalide, quota épuisé) sans avoir à comparer deux pages.
  const searchPathSteps = [];
  if (services.googleBooks) {
    searchPathSteps.push({
      name: 'Google Books',
      state: !services.googleBooks.enabled ? 'off' : services.googleBooks.connected ? 'ok' : 'error',
    });
  }
  if (services.hardcover) {
    searchPathSteps.push({
      name: 'Hardcover',
      state: !services.hardcover.enabled ? 'off' : services.hardcover.connected ? 'ok' : 'error',
    });
  }
  searchPathSteps.push({ name: 'Open Library', state: 'ok' }); // toujours disponible, pas de toggle

  const proxy = services.proxy;
  const proxyState = !proxy?.enabled ? null : proxy.connected ? 'ok' : 'error';

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

      {(services.googleBooks || services.hardcover) && (
        <div className={styles.searchPathBanner}>
          <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M5 12h14M13 6l6 6-6 6"/>
          </svg>
          <span>
            <strong>Chemin de recherche observé :</strong>{' '}
            {searchPathSteps.map((step, i) => (
              <React.Fragment key={step.name}>
                {i > 0 && ' → '}
                <span
                  className={
                    step.state === 'off' ? styles.searchPathStepOff
                    : step.state === 'error' ? styles.searchPathStepError
                    : styles.searchPathStepOk
                  }
                  title={step.state === 'off' ? 'Désactivé' : step.state === 'error' ? 'Activé mais en échec' : 'Actif'}
                >
                  {step.name}
                </span>
              </React.Fragment>
            ))}
            {proxyState && (
              <span
                className={proxyState === 'ok' ? styles.searchPathProxyOk : styles.searchPathProxyError}
                title={proxyState === 'ok' ? `Proxy sortant actif et joignable (mode ${proxy.mode === 'default' ? 'par défaut' : 'repli'})` : 'Proxy sortant activé mais injoignable — retry en connexion directe utilisé à la place'}
              >
                {' '}· proxy sortant {proxyState === 'ok' ? 'actif' : 'en échec'}
              </span>
            )}
          </span>
        </div>
      )}

      <div className={styles.grid}>
        <div className={styles.card}>
          <div className={styles.cardIcon}>{WS_ICON}</div>
          <div className={styles.cardBody}>
            <div className={styles.cardTop}>
              <span className={styles.cardName}>WebSocket</span>
              <span className={styles.dotWrap}>
                {wsConnected && <span className={styles.dotPing} />}
                <span className={`${styles.dot} ${wsConnected ? styles.dotOk : styles.dotError}`} />
              </span>
            </div>
            <ul className={styles.details}>
              <li>{wsConnected ? 'Connexion temps réel active' : 'Non connecté — polling actif'}</li>
            </ul>
          </div>
        </div>

        {SERVICE_DEFS.map((def) => {
          const s = services[def.key];
          if (!s) return null;
          const enabled = def.isEnabled(s);
          if (def.hideIfDisabled && !enabled) return null;
          const connected = enabled && def.isConnected(s);
          const isWarning = enabled && !!def.isWarning?.(s);
          const details = def.details(s);
          const err = def.error(s);
          const warning = def.warning?.(s);
          const label = typeof def.label === 'function' ? def.label(s) : def.label;
          const icon = typeof def.icon === 'function' ? def.icon(s) : def.icon;
          const dotClass = !enabled ? styles.dotDisabled : isWarning ? styles.dotWarning : connected ? styles.dotOk : styles.dotError;

          return (
            <div key={def.key} className={`${styles.card} ${!enabled ? styles.cardDisabled : ''}`}>
              <div className={styles.cardIcon}>{icon}</div>
              <div className={styles.cardBody}>
                <div className={styles.cardTop}>
                  <span className={styles.cardName}>{label}</span>
                  <span className={styles.dotWrap}>
                    {connected && <span className={styles.dotPing} />}
                    <span className={`${styles.dot} ${dotClass}`} />
                  </span>
                </div>
                {details.length > 0 && (
                  <ul className={styles.details}>
                    {details.map((d, i) => <li key={i}>{d}</li>)}
                  </ul>
                )}
                {warning && <p className={styles.cardWarning}>{warning}</p>}
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