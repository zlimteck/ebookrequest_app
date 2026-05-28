import React, { useState, useEffect } from 'react';
import axiosAdmin from '../../axiosAdmin';
import styles from './NotificationsConfig.module.css';

const EXAMPLES = [
  { label: 'Pushover', url: 'pover://userKey@apiToken' },
  { label: 'Discord', url: 'discord://webhook_id/webhook_token' },
  { label: 'Telegram', url: 'tgram://bottoken/ChatID' },
  { label: 'Slack', url: 'slack://TokenA/TokenB/TokenC/' },
  { label: 'Gotify', url: 'gotify://hostname/token' },
  { label: 'Ntfy', url: 'ntfy://hostname/topic' },
];

const NotificationsConfig = () => {
  const [config, setConfig] = useState({
    enabled: false,
    appriseUrls: '',
    notifyOnNewRequest: true,
    notifyOnComplete:   true,
    notifyOnCancel:     true,
    notifyOnComment:    true,
    notifyOnReport:     true,
    notifyOnNewUser:    false,
  });

  const NOTIFY_EVENTS = [
    { key: 'notifyOnNewRequest', label: 'Nouvelle demande de livre' },
    { key: 'notifyOnComplete',   label: 'Livre complété (disponible)' },
    { key: 'notifyOnCancel',     label: 'Demande annulée' },
    { key: 'notifyOnComment',    label: 'Commentaire utilisateur' },
    { key: 'notifyOnReport',     label: 'Signalement d\'un problème' },
    { key: 'notifyOnNewUser',    label: 'Nouvel utilisateur inscrit' },
  ];

  const [emailPrefs, setEmailPrefs] = useState({ enabled: true, notifyOnNewRequest: true });

  const [loading, setLoading] = useState(true);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [appriseRes, emailRes] = await Promise.all([
          axiosAdmin.get('/api/apprise/config'),
          axiosAdmin.get('/api/connectors/email'),
        ]);
        setConfig(prev => ({ ...prev, ...appriseRes.data }));
        setEmailPrefs({ enabled: emailRes.data.enabled ?? true, notifyOnNewRequest: emailRes.data.notifyOnNewRequest ?? true });
      } catch (error) {
        console.error('Erreur chargement config:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, []);

  const handleEmailChange = async (e) => {
    const { name, checked } = e.target;
    const updated = { ...emailPrefs, [name]: checked };
    setEmailPrefs(updated);
    try {
      await axiosAdmin.put('/api/connectors/email', updated);
    } catch {
      // silencieux
    }
  };

  const handleChange = async (e) => {
    const { name, value, type, checked } = e.target;
    const val = type === 'checkbox' ? checked : value;
    const updated = { ...config, [name]: val };
    setConfig(updated);
    // Auto-save pour les toggles et cases à cocher (pas le textarea d'URLs)
    if (type === 'checkbox') {
      try {
        await axiosAdmin.put('/api/apprise/config', updated);
      } catch {
        // silencieux
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setTestResult(null);
    try {
      await axiosAdmin.put('/api/apprise/config', config);
      setTestResult({ type: 'success', message: 'Configuration enregistrée avec succès !' });
    } catch (error) {
      setTestResult({ type: 'error', message: error.response?.data?.message || 'Erreur lors de la sauvegarde' });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!config.enabled || !config.appriseUrls?.trim()) {
      setTestResult({ type: 'error', message: 'Activez et configurez Apprise avant de tester' });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const response = await axiosAdmin.post('/api/apprise/test');
      setTestResult({ type: 'success', message: response.data.message || 'Notification de test envoyée !' });
    } catch (error) {
      setTestResult({ type: 'error', message: error.response?.data?.message || 'Erreur lors du test' });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.spinner} />
        <p>Chargement...</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      {/* ── Email Admin ── */}
      <div className={styles.settingsCard}>
        <h2 className={styles.sectionTitle}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
          </svg>
          Email
        </h2>

        <div className={styles.toggleRow}>
          <div className={styles.toggleInfo}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.toggleIcon}>
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
            </svg>
            <div>
              <p className={styles.toggleLabel}>Activer les notifications email</p>
              <p className={styles.toggleDesc}>Recevoir des emails pour les événements sélectionnés</p>
            </div>
          </div>
          <label className={styles.switch}>
            <input type="checkbox" name="enabled" checked={emailPrefs.enabled} onChange={handleEmailChange} />
            <span className={styles.slider} />
          </label>
        </div>

        {emailPrefs.enabled && (
          <div className={styles.eventsGrid}>
            <label className={styles.eventRow}>
              <input
                type="checkbox"
                name="notifyOnNewRequest"
                checked={!!emailPrefs.notifyOnNewRequest}
                onChange={handleEmailChange}
                className={styles.eventCheckbox}
              />
              <span className={styles.eventLabel}>Nouvelle demande soumise</span>
            </label>
          </div>
        )}
      </div>

      {/* ── Activation ── */}
      <div className={styles.settingsCard}>
        <h2 className={styles.sectionTitle}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          Apprise
        </h2>

        <div className={styles.toggleRow}>
          <div className={styles.toggleInfo}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.toggleIcon}>
              <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>
            </svg>
            <div>
              <p className={styles.toggleLabel}>Activer Apprise</p>
              <p className={styles.toggleDesc}>Envoyez des notifications via n'importe quel service supporté</p>
            </div>
          </div>
          <label className={styles.switch}>
            <input type="checkbox" name="enabled" checked={config.enabled} onChange={handleChange} />
            <span className={styles.slider} />
          </label>
        </div>

        {config.enabled && (
          <div className={styles.eventsGrid}>
            {NOTIFY_EVENTS.map(ev => (
              <label key={ev.key} className={styles.eventRow}>
                <input
                  type="checkbox"
                  name={ev.key}
                  checked={!!config[ev.key]}
                  onChange={handleChange}
                  className={styles.eventCheckbox}
                />
                <span className={styles.eventLabel}>{ev.label}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* ── URLs ── */}
      {config.enabled && (
        <div className={styles.settingsCard}>
          <h2 className={styles.sectionTitle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
            URLs de notification
          </h2>

          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel}>URLs Apprise <span className={styles.fieldLabelMuted}>(une par ligne)</span></label>
            <textarea
              name="appriseUrls"
              value={config.appriseUrls}
              onChange={handleChange}
              className={styles.fieldTextarea}
              placeholder={'pover://userKey@apiToken\ndiscord://webhook_id/webhook_token'}
              rows={4}
              spellCheck={false}
            />
            <p className={styles.fieldHint}>
              Voir la liste complète des services sur{' '}
              <a href="https://github.com/caronc/apprise/wiki" target="_blank" rel="noopener noreferrer">
                github.com/caronc/apprise/wiki
              </a>
            </p>
          </div>

          {/* Exemples */}
          <div className={styles.examplesWrap}>
            <p className={styles.examplesLabel}>Exemples rapides :</p>
            <div className={styles.examplesList}>
              {EXAMPLES.map(ex => (
                <button
                  key={ex.label}
                  type="button"
                  className={styles.exampleChip}
                  onClick={() => setConfig(prev => ({
                    ...prev,
                    appriseUrls: prev.appriseUrls
                      ? prev.appriseUrls.trimEnd() + '\n' + ex.url
                      : ex.url
                  }))}
                >
                  + {ex.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Guide (si désactivé) ── */}
      {!config.enabled && (
        <div className={styles.settingsCard}>
          <h2 className={styles.sectionTitle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            À propos d'Apprise
          </h2>
          <p className={styles.guideDesc}>
            Apprise permet d'envoyer des notifications vers plus de 100 services (Pushover, Discord, Telegram, Slack, Gotify, Ntfy...) via une URL universelle.
          </p>
          <ol className={styles.guideList}>
            <li>Activez Apprise ci-dessus</li>
            <li>Entrez l'URL du service de votre choix — ex: <code>pover://userKey@apiToken</code></li>
            <li>Consultez la <a href="https://github.com/caronc/apprise/wiki" target="_blank" rel="noopener noreferrer">documentation Apprise</a> pour tous les formats</li>
            <li>Testez la configuration avec le bouton "Tester"</li>
          </ol>
        </div>
      )}

      {/* ── Actions ── */}
      <div className={styles.cardActions}>
        <button type="submit" className={styles.btnPrimary} disabled={saving}>
          {saving ? 'Enregistrement...' : 'Enregistrer'}
        </button>
        {config.enabled && config.appriseUrls?.trim() && (
          <button type="button" className={styles.btnTest} onClick={handleTest} disabled={testing}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            {testing ? 'Envoi...' : 'Tester'}
          </button>
        )}
      </div>

      {testResult && (
        <div className={`${styles.alert} ${testResult.type === 'success' ? styles.alertSuccess : styles.alertError}`}>
          {testResult.type === 'success'
            ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          }
          {testResult.message}
        </div>
      )}

    </form>
  );
};

export default NotificationsConfig;