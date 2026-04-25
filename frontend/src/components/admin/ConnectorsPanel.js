import React, { useEffect, useState } from 'react';
import axiosAdmin from '../../axiosAdmin';
import styles from './ConnectorsPanel.module.css';

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

function ConnectorCard({ serviceKey, name, description, urlPlaceholder, apiKeyHint, logo, extraFields }) {
  const [config, setConfig] = useState({ enabled: false, url: '', apiKey: '', comicVineApiKey: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [alert, setAlert] = useState(null);

  useEffect(() => {
    axiosAdmin.get(`/api/connectors/${serviceKey}`)
      .then(res => setConfig({
        enabled: res.data.enabled ?? false,
        url: res.data.url ?? '',
        apiKey: res.data.apiKey ?? '',
        comicVineApiKey: res.data.comicVineApiKey ?? '',
      }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [serviceKey]);

  const showAlertMsg = (type, message) => {
    setAlert({ type, message });
    setTimeout(() => setAlert(null), 5000);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setAlert(null);
    try {
      await axiosAdmin.put(`/api/connectors/${serviceKey}`, config);
      showAlertMsg('success', 'Configuration enregistrée.');
    } catch (err) {
      showAlertMsg('error', err.response?.data?.error || 'Erreur lors de la sauvegarde.');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!config.url || !config.apiKey) {
      showAlertMsg('error', 'Renseignez l\'URL et la clé API avant de tester.');
      return;
    }
    setTesting(true);
    setAlert(null);
    try {
      const res = await axiosAdmin.post(`/api/connectors/${serviceKey}/test`, { url: config.url, apiKey: config.apiKey });
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

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardBrand}>
          <div className={styles.cardLogoWrap}>{logo}</div>
          <div>
            <p className={styles.cardName}>{name}</p>
            <p className={styles.cardDesc}>{description}</p>
          </div>
        </div>
        <label className={styles.switch}>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={e => setConfig(c => ({ ...c, enabled: e.target.checked }))}
          />
          <span className={styles.slider} />
        </label>
      </div>

      <form className={styles.form} onSubmit={handleSave}>
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel}>URL</label>
          <input
            className={styles.fieldInput}
            type="url"
            placeholder={urlPlaceholder}
            value={config.url}
            onChange={e => setConfig(c => ({ ...c, url: e.target.value }))}
          />
        </div>

        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel}>Clé API</label>
          <div className={styles.fieldInputWrap}>
            <input
              className={styles.fieldInput}
              type={showKey ? 'text' : 'password'}
              placeholder={`Clé API ${name}`}
              value={config.apiKey}
              onChange={e => setConfig(c => ({ ...c, apiKey: e.target.value }))}
            />
            <button type="button" className={styles.eyeBtn} onClick={() => setShowKey(v => !v)} title={showKey ? 'Masquer' : 'Afficher'}>
              <EyeIcon open={showKey} />
            </button>
          </div>
          {apiKeyHint && <p className={styles.fieldHint}>{apiKeyHint}</p>}
        </div>

        {extraFields?.comicVine && (
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel}>Clé API ComicVine</label>
            <div className={styles.fieldInputWrap}>
              <input
                className={styles.fieldInput}
                type={showKey ? 'text' : 'password'}
                placeholder="Clé API ComicVine"
                value={config.comicVineApiKey}
                onChange={e => setConfig(c => ({ ...c, comicVineApiKey: e.target.value }))}
              />
              <button type="button" className={styles.eyeBtn} onClick={() => setShowKey(v => !v)} title={showKey ? 'Masquer' : 'Afficher'}>
                <EyeIcon open={showKey} />
              </button>
            </div>
            <p className={styles.fieldHint}>
              Disponible sur <a href="https://comicvine.gamespot.com/api/" target="_blank" rel="noreferrer" style={{color:'var(--color-accent)'}}>comicvine.gamespot.com/api</a> — nécessaire pour rechercher les comics et mangas.
            </p>
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

// ─── Valentine card (credentials-based, no API key) ──────────────────────────
function ValentineCard() {
  const [config, setConfig] = useState({
    enabled: false,
    url: 'https://valentine.wtf',
    username: '',
    password: '',
    _hasPassword: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [alert, setAlert] = useState(null);

  useEffect(() => {
    axiosAdmin.get('/api/connectors/valentine')
      .then(res => setConfig({
        enabled: res.data.enabled ?? false,
        url: res.data.url || 'https://valentine.wtf',
        username: res.data.username || '',
        password: res.data.password || '',
        _hasPassword: res.data._hasPassword ?? false,
      }))
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
      await axiosAdmin.put('/api/connectors/valentine', config);
      showAlertMsg('success', 'Configuration enregistrée.');
    } catch (err) {
      showAlertMsg('error', err.response?.data?.error || 'Erreur lors de la sauvegarde.');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!config.username || (!config.password && !config._hasPassword)) {
      showAlertMsg('error', 'Renseignez l\'identifiant et le mot de passe avant de tester.');
      return;
    }
    setTesting(true);
    setAlert(null);
    try {
      const res = await axiosAdmin.post('/api/connectors/valentine/test', {
        username: config.username,
        password: config.password,
      });
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

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardBrand}>
          <div className={styles.cardLogoWrap}>
            <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
          </div>
          <div>
            <p className={styles.cardName}>Valentine.wtf</p>
            <p className={styles.cardDesc}>Télécharge automatiquement les ebooks demandés depuis valentine.wtf.</p>
          </div>
        </div>
        <label className={styles.switch}>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={e => setConfig(c => ({ ...c, enabled: e.target.checked }))}
          />
          <span className={styles.slider} />
        </label>
      </div>

      <form className={styles.form} onSubmit={handleSave}>
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel}>URL</label>
          <input
            className={styles.fieldInput}
            type="url"
            placeholder="https://valentine.wtf"
            value={config.url}
            onChange={e => setConfig(c => ({ ...c, url: e.target.value }))}
          />
          <p className={styles.fieldHint}>Laisser par défaut sauf si vous utilisez un miroir.</p>
        </div>

        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel}>Identifiant</label>
          <input
            className={styles.fieldInput}
            type="text"
            placeholder="Votre login valentine.wtf"
            value={config.username}
            autoComplete="off"
            onChange={e => setConfig(c => ({ ...c, username: e.target.value }))}
          />
        </div>

        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel}>Mot de passe</label>
          <div className={styles.fieldInputWrap}>
            <input
              className={styles.fieldInput}
              type={showPass ? 'text' : 'password'}
              placeholder={config._hasPassword ? '••••••••' : 'Votre mot de passe valentine.wtf'}
              value={config.password}
              autoComplete="new-password"
              onChange={e => setConfig(c => ({ ...c, password: e.target.value }))}
            />
            <button type="button" className={styles.eyeBtn} onClick={() => setShowPass(v => !v)} title={showPass ? 'Masquer' : 'Afficher'}>
              <EyeIcon open={showPass} />
            </button>
          </div>
          {config._hasPassword && !config.password && (
            <p className={styles.fieldHint}>Mot de passe déjà enregistré — laisser vide pour conserver.</p>
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

const LAZY_LOGO = (
  <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
    <line x1="9" y1="9" x2="15" y2="9"/>
    <line x1="9" y1="13" x2="13" y2="13"/>
  </svg>
);

const MYLAR_LOGO = (
  <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="9" rx="1"/>
    <rect x="14" y="3" width="7" height="9" rx="1"/>
    <rect x="3" y="15" width="7" height="6" rx="1"/>
    <rect x="14" y="15" width="7" height="6" rx="1"/>
  </svg>
);

export default function ConnectorsPanel() {
  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
          </svg>
          Connecteurs
        </h2>
        <p className={styles.panelSubtitle}>Intégrations avec des services tiers pour la gestion des livres.</p>
      </div>

      <ConnectorCard
        serviceKey="lazylibrarian"
        name="LazyLibrarian"
        description="Ajoute automatiquement les demandes de livres à votre liste wanted LazyLibrarian."
        urlPlaceholder="http://192.168.1.10:5299"
        apiKeyHint="Disponible dans LazyLibrarian → Config → Interface → API Key."
        logo={LAZY_LOGO}
      />

      <ConnectorCard
        serviceKey="mylar3"
        name="Mylar3"
        description="Ajoute automatiquement les demandes de comics et mangas à votre liste Mylar3."
        urlPlaceholder="http://192.168.1.10:8090"
        apiKeyHint="Disponible dans Mylar3 → Paramètres → Interface Web → Clé API."
        logo={MYLAR_LOGO}
        extraFields={{ comicVine: true }}
      />

      <ValentineCard />
    </div>
  );
}