import React, { useState, useEffect } from 'react';
import axiosAdmin from '../../axiosAdmin';
import styles from './AppriseConfig.module.css';

const EXAMPLES = [
  { label: 'Pushover', url: 'pover://userKey@apiToken' },
  { label: 'Discord', url: 'discord://webhook_id/webhook_token' },
  { label: 'Telegram', url: 'tgram://bottoken/ChatID' },
  { label: 'Slack', url: 'slack://TokenA/TokenB/TokenC/' },
  { label: 'Gotify', url: 'gotify://hostname/token' },
  { label: 'Ntfy', url: 'ntfy://hostname/topic' },
];

const AppriseConfig = () => {
  const [config, setConfig] = useState({
    enabled: false,
    appriseUrls: '',
    notifyOnNewRequest: true
  });
  const [loading, setLoading] = useState(true);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await axiosAdmin.get('/api/apprise/config');
        setConfig(prev => ({ ...prev, ...response.data }));
      } catch (error) {
        console.error('Erreur chargement config Apprise:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchConfig();
  }, []);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setConfig(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
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
          <div className={styles.toggleRow}>
            <div className={styles.toggleInfo}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.toggleIcon}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
              <div>
                <p className={styles.toggleLabel}>Nouvelles demandes</p>
                <p className={styles.toggleDesc}>Notification à chaque nouvelle demande de livre</p>
              </div>
            </div>
            <label className={styles.switch}>
              <input type="checkbox" name="notifyOnNewRequest" checked={config.notifyOnNewRequest} onChange={handleChange} />
              <span className={styles.slider} />
            </label>
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

export default AppriseConfig;