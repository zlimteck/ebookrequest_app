import React, { useEffect, useState } from 'react';
import axiosAdmin from '../../axiosAdmin';
import styles from './ConnectorsPanel.module.css';
import { OpenAIIcon, ClaudeIcon, OllamaIcon, GoogleIcon } from './brandIcons';
import hardcoverLogo from '../../assets/icons/hardcover.png';

const AI_PROVIDER_ICONS = { openai: OpenAIIcon, claude: ClaudeIcon, ollama: OllamaIcon };

const EyeIcon = ({ open }) => open ? (
  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
) : (
  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
);

const CheckIcon = () => (
  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

const AlertIcon = () => (
  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
  </svg>
);

function GoogleBooksCard() {
  const [config, setConfig] = useState({ enabled: false, apiKey: '', _hasApiKey: false, _envFallback: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [alert, setAlert] = useState(null);

  useEffect(() => {
    axiosAdmin.get('/api/connectors/googlebooks')
      .then(res => {
        setConfig({
          enabled: res.data.enabled ?? false,
          apiKey: res.data.apiKey || '',
          _hasApiKey: res.data._hasApiKey ?? false,
          _envFallback: res.data._envFallback ?? false,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const showAlertMsg = (type, message) => {
    setAlert({ type, message });
    setTimeout(() => setAlert(null), 5000);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setAlert(null);
    try {
      // `enabled` volontairement omis : géré exclusivement par le toggle (auto-save
      // immédiat), pour qu'"Enregistrer" ne puisse jamais le réécrire par erreur.
      const res = await axiosAdmin.put('/api/connectors/googlebooks', { apiKey: config.apiKey, _hasApiKey: config._hasApiKey });
      setConfig(c => ({ ...c, apiKey: res.data.apiKey, _hasApiKey: res.data._hasApiKey }));
      showAlertMsg('success', 'Configuration enregistrée.');
    } catch (err) {
      showAlertMsg('error', err.response?.data?.error || 'Erreur lors de la sauvegarde.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (e) => {
    const enabled = e.target.checked;
    setConfig(c => ({ ...c, enabled }));
    try {
      const res = await axiosAdmin.put('/api/connectors/googlebooks', { ...config, enabled });
      setConfig(c => ({ ...c, enabled: res.data.enabled, apiKey: res.data.apiKey, _hasApiKey: res.data._hasApiKey }));
      window.dispatchEvent(new Event('ebookrequest:search-settings-changed'));
    } catch (err) {
      setConfig(c => ({ ...c, enabled: !enabled }));
      showAlertMsg('error', err.response?.data?.error || 'Erreur lors de la sauvegarde.');
    }
  };

  const handleTest = async () => {
    if (!config.apiKey && !config._hasApiKey) {
      showAlertMsg('error', 'Renseignez une clé API avant de tester.');
      return;
    }
    setTesting(true);
    setAlert(null);
    try {
      const res = await axiosAdmin.post('/api/connectors/googlebooks/test', { apiKey: config.apiKey });
      showAlertMsg('success', res.data.message || 'Clé valide !');
    } catch (err) {
      showAlertMsg('error', err.response?.data?.error || 'Clé invalide.');
    } finally {
      setTesting(false);
    }
  };

  if (loading) return (
    <div className={styles.card}>
      <div className={styles.cardLoading}><div className={styles.spinner} /></div>
    </div>
  );

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardBrand}>
          <div className={styles.cardLogoWrap}>
            <GoogleIcon size={24} />
          </div>
          <div>
            <p className={styles.cardName}>Google Books</p>
            <p className={styles.cardDesc}>Source principale pour la recherche de livres, les couvertures et l'enrichissement des recommandations/bestsellers. Désactiver bascule directement sur Hardcover puis Open Library.</p>
          </div>
        </div>
        <label className={styles.switch}>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={handleToggle}
          />
          <span className={styles.slider} />
        </label>
      </div>

      {!config.enabled && config._envFallback && (
        <div className={styles.nextScan}>
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          Clé de la variable d'environnement <code>GOOGLE_BOOKS_API_KEY</code> utilisée par défaut.
        </div>
      )}

      <form className={styles.form} onSubmit={handleSave}>
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel}>Clé API</label>
          <div className={styles.fieldInputWrap}>
            <input
              className={styles.fieldInput}
              type={showKey ? 'text' : 'password'}
              placeholder={config._hasApiKey ? '••••••••' : 'Votre clé API Google Books'}
              value={config.apiKey}
              autoComplete="off"
              onChange={e => setConfig(c => ({ ...c, apiKey: e.target.value }))}
            />
            <button type="button" className={styles.eyeBtn} onClick={() => setShowKey(v => !v)} title={showKey ? 'Masquer' : 'Afficher'}>
              <EyeIcon open={showKey} />
            </button>
          </div>
          {config._hasApiKey && !config.apiKey && (
            <p className={styles.fieldHint}>Clé déjà enregistrée - laisser vide pour conserver.</p>
          )}
        </div>

        {alert && (
          <div className={`${styles.alert} ${alert.type === 'success' ? styles.alertSuccess : styles.alertError}`}>
            {alert.type === 'success' ? <CheckIcon /> : <AlertIcon />}
            {alert.message}
          </div>
        )}

        <div className={styles.cardActions}>
          <button type="button" className={styles.btnTest} onClick={handleTest} disabled={testing || saving}>
            {testing ? (
              <><span className={styles.spinnerSmall} />Test en cours…</>
            ) : (
              <>
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                Tester la clé
              </>
            )}
          </button>
          <button type="submit" className={styles.btnPrimary} disabled={saving || testing}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </div>
  );
}

const HardcoverIcon = ({ size = 24 }) => (
  <img
    src={hardcoverLogo}
    alt="Hardcover"
    style={{ width: size, height: size, objectFit: 'contain' }}
  />
);

function HardcoverCard() {
  const [config, setConfig] = useState({ enabled: false, apiKey: '', _hasApiKey: false, _keyUpdatedAt: null });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [alert, setAlert] = useState(null);

  useEffect(() => {
    axiosAdmin.get('/api/connectors/hardcover')
      .then(res => {
        setConfig({
          enabled: res.data.enabled ?? false,
          apiKey: res.data.apiKey || '',
          _hasApiKey: res.data._hasApiKey ?? false,
          _keyUpdatedAt: res.data._keyUpdatedAt || null,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const showAlertMsg = (type, message) => {
    setAlert({ type, message });
    setTimeout(() => setAlert(null), 5000);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setAlert(null);
    try {
      const res = await axiosAdmin.put('/api/connectors/hardcover', { apiKey: config.apiKey, _hasApiKey: config._hasApiKey });
      setConfig(c => ({ ...c, apiKey: res.data.apiKey, _hasApiKey: res.data._hasApiKey, _keyUpdatedAt: res.data._keyUpdatedAt || null }));
      showAlertMsg('success', 'Configuration enregistrée.');
    } catch (err) {
      showAlertMsg('error', err.response?.data?.error || 'Erreur lors de la sauvegarde.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (e) => {
    const enabled = e.target.checked;
    setConfig(c => ({ ...c, enabled }));
    try {
      const res = await axiosAdmin.put('/api/connectors/hardcover', { ...config, enabled });
      setConfig(c => ({ ...c, enabled: res.data.enabled, apiKey: res.data.apiKey, _hasApiKey: res.data._hasApiKey, _keyUpdatedAt: res.data._keyUpdatedAt || null }));
      window.dispatchEvent(new Event('ebookrequest:search-settings-changed'));
    } catch (err) {
      setConfig(c => ({ ...c, enabled: !enabled }));
      showAlertMsg('error', err.response?.data?.error || 'Erreur lors de la sauvegarde.');
    }
  };

  const handleTest = async () => {
    if (!config.apiKey && !config._hasApiKey) {
      showAlertMsg('error', 'Renseignez une clé API avant de tester.');
      return;
    }
    setTesting(true);
    setAlert(null);
    try {
      const res = await axiosAdmin.post('/api/connectors/hardcover/test', { apiKey: config.apiKey });
      showAlertMsg('success', res.data.message || 'Clé valide !');
    } catch (err) {
      showAlertMsg('error', err.response?.data?.error || 'Clé invalide.');
    } finally {
      setTesting(false);
    }
  };

  if (loading) return (
    <div className={styles.card}>
      <div className={styles.cardLoading}><div className={styles.spinner} /></div>
    </div>
  );

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardBrand}>
          <div className={styles.cardLogoWrap}>
            <HardcoverIcon size={24} />
          </div>
          <div>
            <p className={styles.cardName}>Hardcover</p>
            <p className={styles.cardDesc}>Clé API utilisée en repli de Google Books quand celui-ci est désactivé ou ne trouve aucun résultat (avant Open Library).</p>
          </div>
        </div>
        <label className={styles.switch}>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={handleToggle}
          />
          <span className={styles.slider} />
        </label>
      </div>

      {config._hasApiKey && config._keyUpdatedAt && (
        <div className={styles.nextScan}>
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          Les clés Hardcover expirent après 1 an et sont réinitialisées chaque 1er janvier pensez à la renouveler sur hardcover.app (dernier enregistrement : {new Date(config._keyUpdatedAt).toLocaleDateString('fr-FR')}).
        </div>
      )}

      <form className={styles.form} onSubmit={handleSave}>
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel}>Clé API</label>
          <div className={styles.fieldInputWrap}>
            <input
              className={styles.fieldInput}
              type={showKey ? 'text' : 'password'}
              placeholder={config._hasApiKey ? '••••••••' : 'Votre clé API Hardcover'}
              value={config.apiKey}
              autoComplete="off"
              onChange={e => setConfig(c => ({ ...c, apiKey: e.target.value }))}
            />
            <button type="button" className={styles.eyeBtn} onClick={() => setShowKey(v => !v)} title={showKey ? 'Masquer' : 'Afficher'}>
              <EyeIcon open={showKey} />
            </button>
          </div>
          {config._hasApiKey && !config.apiKey && (
            <p className={styles.fieldHint}>Clé déjà enregistrée - laisser vide pour conserver.</p>
          )}
        </div>

        {alert && (
          <div className={`${styles.alert} ${alert.type === 'success' ? styles.alertSuccess : styles.alertError}`}>
            {alert.type === 'success' ? <CheckIcon /> : <AlertIcon />}
            {alert.message}
          </div>
        )}

        <div className={styles.cardActions}>
          <button type="button" className={styles.btnTest} onClick={handleTest} disabled={testing || saving}>
            {testing ? (
              <><span className={styles.spinnerSmall} />Test en cours…</>
            ) : (
              <>
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                Tester la clé
              </>
            )}
          </button>
          <button type="submit" className={styles.btnPrimary} disabled={saving || testing}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </div>
  );
}

function ProxyCard() {
  const [config, setConfig] = useState({
    enabled: false, url: '', mode: 'fallback', username: '', password: '', _hasPassword: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [alert, setAlert] = useState(null);

  useEffect(() => {
    axiosAdmin.get('/api/connectors/proxy')
      .then(res => {
        setConfig({
          enabled: res.data.enabled ?? false,
          url: res.data.url || '',
          mode: res.data.mode || 'fallback',
          username: res.data.username || '',
          password: res.data.password || '',
          _hasPassword: res.data._hasPassword ?? false,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const showAlertMsg = (type, message) => {
    setAlert({ type, message });
    setTimeout(() => setAlert(null), 5000);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setAlert(null);
    try {
      const { enabled, ...rest } = config;
      const res = await axiosAdmin.put('/api/connectors/proxy', rest);
      setConfig(c => ({ ...c, password: res.data.password, _hasPassword: res.data._hasPassword }));
      showAlertMsg('success', 'Configuration enregistrée.');
    } catch (err) {
      showAlertMsg('error', err.response?.data?.error || 'Erreur lors de la sauvegarde.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (e) => {
    const enabled = e.target.checked;
    setConfig(c => ({ ...c, enabled }));
    try {
      const res = await axiosAdmin.put('/api/connectors/proxy', { ...config, enabled });
      setConfig(c => ({ ...c, enabled: res.data.enabled, password: res.data.password, _hasPassword: res.data._hasPassword }));
      window.dispatchEvent(new Event('ebookrequest:search-settings-changed'));
    } catch (err) {
      setConfig(c => ({ ...c, enabled: !enabled }));
      showAlertMsg('error', err.response?.data?.error || 'Erreur lors de la sauvegarde.');
    }
  };

  const handleTest = async () => {
    if (!config.url) {
      showAlertMsg('error', 'Renseignez une URL de proxy avant de tester.');
      return;
    }
    setTesting(true);
    setAlert(null);
    try {
      const res = await axiosAdmin.post('/api/connectors/proxy/test', {
        url: config.url, username: config.username, password: config.password,
      });
      showAlertMsg('success', res.data.message || 'Proxy fonctionnel !');
    } catch (err) {
      showAlertMsg('error', err.response?.data?.error || 'Proxy inaccessible.');
    } finally {
      setTesting(false);
    }
  };

  if (loading) return (
    <div className={styles.card}>
      <div className={styles.cardLoading}><div className={styles.spinner} /></div>
    </div>
  );

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardBrand}>
          <div className={styles.cardLogoWrap}>
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
          </div>
          <div>
            <p className={styles.cardName}>Proxy sortant</p>
            <p className={styles.cardDesc}>Utilisé pour les appels vers Google Books et Open Library, si votre IP serveur est throttlée/bloquée.</p>
          </div>
        </div>
        <label className={styles.switch}>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={handleToggle}
          />
          <span className={styles.slider} />
        </label>
      </div>

      <form className={styles.form} onSubmit={handleSave}>
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel}>Mode</label>
          <select
            className={styles.fieldInput}
            value={config.mode}
            onChange={e => setConfig(c => ({ ...c, mode: e.target.value }))}
          >
            <option value="fallback">Repli — connexion directe en priorité, proxy si échec</option>
            <option value="default">Par défaut — proxy en priorité, connexion directe si échec</option>
          </select>
        </div>

        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel}>URL du proxy</label>
          <input
            className={styles.fieldInput}
            type="text"
            placeholder="http://mon-proxy.example.com:8080"
            value={config.url}
            autoComplete="off"
            onChange={e => setConfig(c => ({ ...c, url: e.target.value }))}
          />
        </div>

        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel}>Utilisateur (optionnel)</label>
          <input
            className={styles.fieldInput}
            type="text"
            value={config.username}
            autoComplete="off"
            onChange={e => setConfig(c => ({ ...c, username: e.target.value }))}
          />
        </div>

        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel}>Mot de passe (optionnel)</label>
          <div className={styles.fieldInputWrap}>
            <input
              className={styles.fieldInput}
              type={showPassword ? 'text' : 'password'}
              placeholder={config._hasPassword ? '••••••••' : ''}
              value={config.password}
              autoComplete="off"
              onChange={e => setConfig(c => ({ ...c, password: e.target.value }))}
            />
            <button type="button" className={styles.eyeBtn} onClick={() => setShowPassword(v => !v)} title={showPassword ? 'Masquer' : 'Afficher'}>
              <EyeIcon open={showPassword} />
            </button>
          </div>
          {config._hasPassword && !config.password && (
            <p className={styles.fieldHint}>
              Mot de passe déjà enregistré — laisser vide pour conserver, ou{' '}
              <button
                type="button"
                className={styles.linkBtn}
                onClick={() => setConfig(c => ({ ...c, password: '', _hasPassword: false }))}
              >
                retirer le mot de passe
              </button>.
            </p>
          )}
        </div>

        {alert && (
          <div className={`${styles.alert} ${alert.type === 'success' ? styles.alertSuccess : styles.alertError}`}>
            {alert.type === 'success' ? <CheckIcon /> : <AlertIcon />}
            {alert.message}
          </div>
        )}

        <div className={styles.cardActions}>
          <button type="button" className={styles.btnTest} onClick={handleTest} disabled={testing || saving}>
            {testing ? (
              <><span className={styles.spinnerSmall} />Test en cours…</>
            ) : (
              <>
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                Tester le proxy
              </>
            )}
          </button>
          <button type="submit" className={styles.btnPrimary} disabled={saving || testing}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </div>
  );
}

const AI_PROVIDER_DEFAULTS = {
  openai: { model: 'gpt-4o-mini', urlField: false },
  claude: { model: 'claude-opus-4-5', urlField: false },
  ollama: { model: '', urlField: true },
};

function AIProviderCard() {
  const [config, setConfig] = useState({
    enabled: false, provider: 'openai', model: '', url: '', apiKey: '', _hasApiKey: false, _envFallback: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [alert, setAlert] = useState(null);

  useEffect(() => {
    axiosAdmin.get('/api/connectors/aiprovider')
      .then(res => {
        setConfig({
          enabled: res.data.enabled ?? false,
          provider: res.data.provider || 'openai',
          model: res.data.model || '',
          url: res.data.url || '',
          apiKey: res.data.apiKey || '',
          _hasApiKey: res.data._hasApiKey ?? false,
          _envFallback: res.data._envFallback ?? false,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const showAlertMsg = (type, message) => {
    setAlert({ type, message });
    setTimeout(() => setAlert(null), 5000);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setAlert(null);
    try {
      const { enabled, ...rest } = config;
      const res = await axiosAdmin.put('/api/connectors/aiprovider', rest);
      setConfig(c => ({ ...c, apiKey: res.data.apiKey, _hasApiKey: res.data._hasApiKey }));
      showAlertMsg('success', 'Configuration enregistrée.');
    } catch (err) {
      showAlertMsg('error', err.response?.data?.error || 'Erreur lors de la sauvegarde.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (e) => {
    const enabled = e.target.checked;
    setConfig(c => ({ ...c, enabled }));
    try {
      const res = await axiosAdmin.put('/api/connectors/aiprovider', { ...config, enabled });
      setConfig(c => ({ ...c, enabled: res.data.enabled, apiKey: res.data.apiKey, _hasApiKey: res.data._hasApiKey }));
    } catch (err) {
      setConfig(c => ({ ...c, enabled: !enabled }));
      showAlertMsg('error', err.response?.data?.error || 'Erreur lors de la sauvegarde.');
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setAlert(null);
    try {
      const res = await axiosAdmin.post('/api/connectors/aiprovider/test', config);
      showAlertMsg('success', res.data.message || 'Connexion réussie !');
    } catch (err) {
      showAlertMsg('error', err.response?.data?.error || 'Connexion impossible.');
    } finally {
      setTesting(false);
    }
  };

  if (loading) return (
    <div className={styles.card}>
      <div className={styles.cardLoading}><div className={styles.spinner} /></div>
    </div>
  );

  const isOllama = config.provider === 'ollama';

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardBrand}>
          <div className={styles.cardLogoWrap}>
            {(() => {
              const BrandIcon = AI_PROVIDER_ICONS[config.provider];
              return BrandIcon ? <BrandIcon size={24} /> : (
                <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/>
                  <path d="M15 2v2M9 2v2M15 20v2M9 20v2M2 15h2M2 9h2M20 15h2M20 9h2"/>
                </svg>
              );
            })()}
          </div>
          <div>
            <p className={styles.cardName}>Fournisseur IA</p>
            <p className={styles.cardDesc}>Utilisé pour les recommandations, les bestsellers et le chatbot.</p>
          </div>
        </div>
        <label className={styles.switch}>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={handleToggle}
          />
          <span className={styles.slider} />
        </label>
      </div>

      {!config.enabled && config._envFallback && (
        <div className={styles.nextScan}>
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          Variables d'environnement (<code>AI_PROVIDER</code> et clés associées) utilisées par défaut.
        </div>
      )}

      <form className={styles.form} onSubmit={handleSave}>
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel}>Fournisseur</label>
          <select
            className={styles.fieldInput}
            value={config.provider}
            onChange={e => setConfig(c => ({ ...c, provider: e.target.value, model: '' }))}
          >
            <option value="openai">OpenAI</option>
            <option value="claude">Claude (Anthropic)</option>
            <option value="ollama">Ollama</option>
          </select>
        </div>

        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel}>Modèle</label>
          <input
            className={styles.fieldInput}
            type="text"
            placeholder={AI_PROVIDER_DEFAULTS[config.provider]?.model || 'Nom du modèle'}
            value={config.model}
            onChange={e => setConfig(c => ({ ...c, model: e.target.value }))}
          />
        </div>

        {isOllama && (
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel}>URL Ollama</label>
            <input
              className={styles.fieldInput}
              type="url"
              placeholder="http://172.17.0.x:11434"
              value={config.url}
              onChange={e => setConfig(c => ({ ...c, url: e.target.value }))}
            />
          </div>
        )}

        {!isOllama && (
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel}>Clé API</label>
            <div className={styles.fieldInputWrap}>
              <input
                className={styles.fieldInput}
                type={showKey ? 'text' : 'password'}
                placeholder={config._hasApiKey ? '••••••••' : 'Clé API'}
                value={config.apiKey}
                autoComplete="off"
                onChange={e => setConfig(c => ({ ...c, apiKey: e.target.value }))}
              />
              <button type="button" className={styles.eyeBtn} onClick={() => setShowKey(v => !v)} title={showKey ? 'Masquer' : 'Afficher'}>
                <EyeIcon open={showKey} />
              </button>
            </div>
            {config._hasApiKey && !config.apiKey && (
              <p className={styles.fieldHint}>Clé déjà enregistrée — laisser vide pour conserver.</p>
            )}
          </div>
        )}

        {alert && (
          <div className={`${styles.alert} ${alert.type === 'success' ? styles.alertSuccess : styles.alertError}`}>
            {alert.type === 'success' ? <CheckIcon /> : <AlertIcon />}
            {alert.message}
          </div>
        )}

        <div className={styles.cardActions}>
          <button type="button" className={styles.btnTest} onClick={handleTest} disabled={testing || saving}>
            {testing ? (
              <><span className={styles.spinnerSmall} />Test en cours…</>
            ) : (
              <>
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                Tester la connexion
              </>
            )}
          </button>
          <button type="submit" className={styles.btnPrimary} disabled={saving || testing}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </div>
  );
}

function RSSFeedCard() {
  const [config, setConfig] = useState({ enabled: false, url: '', _envFallback: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState(null);

  useEffect(() => {
    axiosAdmin.get('/api/connectors/rss')
      .then(res => {
        setConfig({
          enabled: res.data.enabled ?? false,
          url: res.data.url || '',
          _envFallback: res.data._envFallback ?? false,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const showAlertMsg = (type, message) => {
    setAlert({ type, message });
    setTimeout(() => setAlert(null), 5000);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { enabled, ...rest } = config;
      await axiosAdmin.put('/api/connectors/rss', rest);
      showAlertMsg('success', 'Configuration enregistrée.');
    } catch (err) {
      showAlertMsg('error', err.response?.data?.error || 'Erreur lors de la sauvegarde.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (e) => {
    const enabled = e.target.checked;
    setConfig(c => ({ ...c, enabled }));
    try {
      await axiosAdmin.put('/api/connectors/rss', { ...config, enabled });
    } catch (err) {
      setConfig(c => ({ ...c, enabled: !enabled }));
      showAlertMsg('error', err.response?.data?.error || 'Erreur lors de la sauvegarde.');
    }
  };

  if (loading) return (
    <div className={styles.card}>
      <div className={styles.cardLoading}><div className={styles.spinner} /></div>
    </div>
  );

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardBrand}>
          <div className={styles.cardLogoWrap}>
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>
            </svg>
          </div>
          <div>
            <p className={styles.cardName}>Flux RSS (PreDB)</p>
            <p className={styles.cardDesc}>Source utilisée pour vérifier la disponibilité des livres avant demande.</p>
          </div>
        </div>
        <label className={styles.switch}>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={handleToggle}
          />
          <span className={styles.slider} />
        </label>
      </div>

      {!config.enabled && config._envFallback && (
        <div className={styles.nextScan}>
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          Variable d'environnement <code>RSS_FEED_URL</code> utilisée par défaut.
        </div>
      )}

      <form className={styles.form} onSubmit={handleSave}>
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel}>URL du flux RSS</label>
          <input
            className={styles.fieldInput}
            type="url"
            placeholder="https://predb.me/?cats=books-ebooks&rss=1"
            value={config.url}
            onChange={e => setConfig(c => ({ ...c, url: e.target.value }))}
          />
        </div>

        {alert && (
          <div className={`${styles.alert} ${alert.type === 'success' ? styles.alertSuccess : styles.alertError}`}>
            {alert.type === 'success' ? <CheckIcon /> : <AlertIcon />}
            {alert.message}
          </div>
        )}

        <div className={styles.cardActions}>
          <button type="submit" className={styles.btnPrimary} disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </div>
  );
}

function EmailProviderCard() {
  const [config, setConfig] = useState({
    enabled: false, provider: 'smtp', smtpHost: '', smtpPort: 465, smtpSecure: false,
    username: '', fromAddress: '', fromName: '', apiKey: '', _hasApiKey: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [alert, setAlert] = useState(null);

  useEffect(() => {
    axiosAdmin.get('/api/connectors/emailprovider')
      .then(res => {
        setConfig({
          enabled: res.data.enabled ?? false,
          provider: res.data.provider || 'smtp',
          smtpHost: res.data.smtpHost || '',
          smtpPort: res.data.smtpPort || 465,
          smtpSecure: res.data.smtpSecure ?? false,
          username: res.data.username || '',
          fromAddress: res.data.fromAddress || '',
          fromName: res.data.fromName || '',
          apiKey: res.data.apiKey || '',
          _hasApiKey: res.data._hasApiKey ?? false,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const showAlertMsg = (type, message) => {
    setAlert({ type, message });
    setTimeout(() => setAlert(null), 6000);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setAlert(null);
    try {
      const { enabled, ...rest } = config;
      const res = await axiosAdmin.put('/api/connectors/emailprovider', rest);
      setConfig(c => ({ ...c, apiKey: res.data.apiKey, _hasApiKey: res.data._hasApiKey }));
      showAlertMsg('success', 'Configuration enregistrée.');
    } catch (err) {
      showAlertMsg('error', err.response?.data?.error || 'Erreur lors de la sauvegarde.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (e) => {
    const enabled = e.target.checked;
    setConfig(c => ({ ...c, enabled }));
    try {
      const res = await axiosAdmin.put('/api/connectors/emailprovider', { ...config, enabled });
      setConfig(c => ({ ...c, enabled: res.data.enabled, apiKey: res.data.apiKey, _hasApiKey: res.data._hasApiKey }));
    } catch (err) {
      setConfig(c => ({ ...c, enabled: !enabled }));
      showAlertMsg('error', err.response?.data?.error || 'Erreur lors de la sauvegarde.');
    }
  };

  const handleTest = async () => {
    if (!testTo.trim()) {
      showAlertMsg('error', 'Renseignez une adresse email de destination.');
      return;
    }
    setTesting(true);
    setAlert(null);
    try {
      const res = await axiosAdmin.post('/api/connectors/emailprovider/test', { ...config, to: testTo });
      showAlertMsg('success', res.data.message || 'Email envoyé !');
    } catch (err) {
      showAlertMsg('error', err.response?.data?.error || 'Envoi impossible.');
    } finally {
      setTesting(false);
    }
  };

  if (loading) return (
    <div className={styles.card}>
      <div className={styles.cardLoading}><div className={styles.spinner} /></div>
    </div>
  );

  const isSmtp = config.provider === 'smtp';

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardBrand}>
          <div className={styles.cardLogoWrap}>
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 5h20v14H2z"/><path d="m2 7 10 7 10-7"/>
            </svg>
          </div>
          <div>
            <p className={styles.cardName}>Fournisseur Email</p>
            <p className={styles.cardDesc}>Utilisé pour les emails transactionnels (vérification, réinitialisation, notifications).</p>
          </div>
        </div>
        <label className={styles.switch}>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={handleToggle}
          />
          <span className={styles.slider} />
        </label>
      </div>

      <form className={styles.form} onSubmit={handleSave}>
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel}>Fournisseur</label>
          <select
            className={styles.fieldInput}
            value={config.provider}
            onChange={e => setConfig(c => ({ ...c, provider: e.target.value }))}
          >
            <option value="smtp">SMTP</option>
            <option value="resend">Resend</option>
          </select>
        </div>

        {isSmtp ? (
          <>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel}>Hôte SMTP</label>
              <input
                className={styles.fieldInput}
                type="text"
                placeholder="smtp.example.com"
                value={config.smtpHost}
                onChange={e => setConfig(c => ({ ...c, smtpHost: e.target.value }))}
              />
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel}>Port</label>
              <input
                className={styles.fieldInput}
                type="number"
                placeholder="465"
                value={config.smtpPort}
                onChange={e => setConfig(c => ({ ...c, smtpPort: e.target.value }))}
              />
            </div>
            <label className={styles.toggleOptionRow}>
              <input
                type="checkbox"
                className={styles.toggleOptionCheckbox}
                checked={config.smtpSecure}
                onChange={e => setConfig(c => ({ ...c, smtpSecure: e.target.checked }))}
              />
              <div className={styles.toggleOptionInfo}>
                <span className={styles.toggleOptionLabel}>Connexion sécurisée (TLS/SSL implicite)</span>
                <p className={styles.toggleOptionDesc}>À activer pour le port 465, désactiver pour le port 587 (STARTTLS).</p>
              </div>
            </label>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel}>Utilisateur SMTP</label>
              <input
                className={styles.fieldInput}
                type="text"
                value={config.username}
                autoComplete="off"
                onChange={e => setConfig(c => ({ ...c, username: e.target.value }))}
              />
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel}>Mot de passe SMTP</label>
              <div className={styles.fieldInputWrap}>
                <input
                  className={styles.fieldInput}
                  type={showKey ? 'text' : 'password'}
                  placeholder={config._hasApiKey ? '••••••••' : ''}
                  value={config.apiKey}
                  autoComplete="off"
                  onChange={e => setConfig(c => ({ ...c, apiKey: e.target.value }))}
                />
                <button type="button" className={styles.eyeBtn} onClick={() => setShowKey(v => !v)} title={showKey ? 'Masquer' : 'Afficher'}>
                  <EyeIcon open={showKey} />
                </button>
              </div>
              {config._hasApiKey && !config.apiKey && (
                <p className={styles.fieldHint}>Mot de passe déjà enregistré — laisser vide pour conserver.</p>
              )}
            </div>
          </>
        ) : (
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel}>Clé API Resend</label>
            <div className={styles.fieldInputWrap}>
              <input
                className={styles.fieldInput}
                type={showKey ? 'text' : 'password'}
                placeholder={config._hasApiKey ? '••••••••' : 're_...'}
                value={config.apiKey}
                autoComplete="off"
                onChange={e => setConfig(c => ({ ...c, apiKey: e.target.value }))}
              />
              <button type="button" className={styles.eyeBtn} onClick={() => setShowKey(v => !v)} title={showKey ? 'Masquer' : 'Afficher'}>
                <EyeIcon open={showKey} />
              </button>
            </div>
            {config._hasApiKey && !config.apiKey && (
              <p className={styles.fieldHint}>Clé déjà enregistrée — laisser vide pour conserver.</p>
            )}
          </div>
        )}

        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel}>Adresse d'expédition</label>
          <input
            className={styles.fieldInput}
            type="email"
            placeholder="noreply@example.com"
            value={config.fromAddress}
            onChange={e => setConfig(c => ({ ...c, fromAddress: e.target.value }))}
          />
        </div>

        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel}>Nom d'expéditeur</label>
          <input
            className={styles.fieldInput}
            type="text"
            placeholder="EbookRequest"
            value={config.fromName}
            onChange={e => setConfig(c => ({ ...c, fromName: e.target.value }))}
          />
        </div>

        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel}>Tester avec l'adresse</label>
          <input
            className={styles.fieldInput}
            type="email"
            placeholder="votre@email.com"
            value={testTo}
            onChange={e => setTestTo(e.target.value)}
          />
        </div>

        {alert && (
          <div className={`${styles.alert} ${alert.type === 'success' ? styles.alertSuccess : styles.alertError}`}>
            {alert.type === 'success' ? <CheckIcon /> : <AlertIcon />}
            {alert.message}
          </div>
        )}

        <div className={styles.cardActions}>
          <button type="button" className={styles.btnTest} onClick={handleTest} disabled={testing || saving}>
            {testing ? (
              <><span className={styles.spinnerSmall} />Envoi en cours…</>
            ) : (
              <>
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
                </svg>
                Envoyer un test
              </>
            )}
          </button>
          <button type="submit" className={styles.btnPrimary} disabled={saving || testing}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </form>
    </div>
  );
}

function SearchPathBanner() {
  const [state, setState] = useState(null); // { googleEnabled, hardcoverEnabled, proxyEnabled, proxyMode }
  const [clearing, setClearing] = useState(false);
  const [clearMsg, setClearMsg] = useState(null);

  useEffect(() => {
    const fetchState = () => {
      Promise.all([
        axiosAdmin.get('/api/connectors/googlebooks').catch(() => ({ data: {} })),
        axiosAdmin.get('/api/connectors/hardcover').catch(() => ({ data: {} })),
        axiosAdmin.get('/api/connectors/proxy').catch(() => ({ data: {} })),
      ]).then(([g, h, p]) => {
        setState({
          googleEnabled: g.data.enabled ?? false,
          hardcoverEnabled: h.data.enabled ?? false,
          proxyEnabled: p.data.enabled ?? false,
          proxyMode: p.data.mode || 'fallback',
        });
      });
    };
    fetchState();
    window.addEventListener('ebookrequest:search-settings-changed', fetchState);
    return () => window.removeEventListener('ebookrequest:search-settings-changed', fetchState);
  }, []);

  if (!state) return null;

  const steps = [];
  if (state.googleEnabled) steps.push('Google Books');
  if (state.hardcoverEnabled) steps.push('Hardcover');
  steps.push('Open Library'); // toujours disponible, pas de toggle

  const handleClearCache = async () => {
    setClearing(true);
    setClearMsg(null);
    try {
      const res = await axiosAdmin.post('/api/admin/search-cache/clear');
      setClearMsg({ type: 'success', text: `Cache vidé (${res.data.cleared} entrée${res.data.cleared > 1 ? 's' : ''}).` });
    } catch {
      setClearMsg({ type: 'error', text: 'Erreur lors du vidage.' });
    } finally {
      setClearing(false);
      setTimeout(() => setClearMsg(null), 5000);
    }
  };

  return (
    <div className={styles.searchPathBanner}>
      <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M5 12h14M13 6l6 6-6 6"/>
      </svg>
      <span style={{ flex: 1 }}>
        <strong>Ordre de recherche actuel :</strong> {steps.join(' → ')}
        {state.proxyEnabled && (
          <span className={styles.searchPathProxyNote}>
            {' '}— proxy sortant actif (mode {state.proxyMode === 'default' ? 'par défaut' : 'repli'}), appliqué à tous les appels sortants.
          </span>
        )}
        <br />
        <button type="button" className={styles.searchPathClearBtn} onClick={handleClearCache} disabled={clearing}>
          {clearing ? 'Vidage…' : 'Vider le cache de recherche'}
        </button>
        {clearMsg && (
          <span className={clearMsg.type === 'success' ? styles.searchPathClearSuccess : styles.searchPathClearError}>
            {' '}{clearMsg.text}
          </span>
        )}
      </span>
    </div>
  );
}

function ManualModeCard() {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState(null);

  useEffect(() => {
    axiosAdmin.get('/api/connectors/manual-mode')
      .then(res => setEnabled(res.data.enabled ?? true))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const showAlertMsg = (type, message) => {
    setAlert({ type, message });
    setTimeout(() => setAlert(null), 5000);
  };

  const handleToggle = async (e) => {
    const value = e.target.checked;
    setEnabled(value);
    try {
      await axiosAdmin.put('/api/connectors/manual-mode', { enabled: value });
    } catch (err) {
      setEnabled(!value);
      showAlertMsg('error', err.response?.data?.error || 'Erreur lors de la sauvegarde.');
    }
  };

  if (loading) return (
    <div className={styles.card}>
      <div className={styles.cardLoading}><div className={styles.spinner} /></div>
    </div>
  );

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardBrand}>
          <div className={styles.cardLogoWrap}>
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
            </svg>
          </div>
          <div>
            <p className={styles.cardName}>Recherche manuelle</p>
            <p className={styles.cardDesc}>Bouton "Manuel" (saisie à blanc) dans "Demander un livre". Le formulaire pré-rempli après une sélection en recherche détaillée n'est pas affecté par ce réglage.</p>
          </div>
        </div>
        <label className={styles.switch}>
          <input type="checkbox" checked={enabled} onChange={handleToggle} />
          <span className={styles.slider} />
        </label>
      </div>
      {alert && (
        <div className={`${styles.alert} ${alert.type === 'success' ? styles.alertSuccess : styles.alertError}`} style={{ margin: '0 1.5rem 1rem' }}>
          {alert.message}
        </div>
      )}
    </div>
  );
}

export default function SettingsPanel() {
  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          Réglages
        </h2>
        <p className={styles.panelSubtitle}>Configuration des fonctionnalités transverses de l'application.</p>
      </div>

      <SearchPathBanner />

      <GoogleBooksCard />
      <HardcoverCard />
      <AIProviderCard />
      <EmailProviderCard />
      <RSSFeedCard />
      <ManualModeCard />
      <ProxyCard />
    </div>
  );
}
