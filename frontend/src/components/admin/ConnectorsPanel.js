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

function useCountdown(targetDate) {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    if (!targetDate) return;

    const update = () => {
      const diff = new Date(targetDate) - Date.now();
      if (diff <= 0) { setTimeLeft('En cours…'); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${h}h ${String(m).padStart(2, '0')}min ${String(s).padStart(2, '0')}s`);
    };

    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [targetDate]);

  return timeLeft;
}

function ValentineCard() {
  const [config, setConfig] = useState({
    enabled: false,
    url: 'https://valentine.wtf',
    username: '',
    password: '',
    _hasPassword: false,
    cronInterval: 6,
    valentineFallbackToAdmin: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [alert, setAlert] = useState(null);
  const [nextScanAt, setNextScanAt] = useState(null);
  const countdown = useCountdown(nextScanAt);
  const [quota, setQuota] = useState(null);
  const [quotaFetchedAt, setQuotaFetchedAt] = useState(null);
  const [valentineStatus, setValentineStatus] = useState(null); // 'ok' | 'error' | null

  useEffect(() => {
    axiosAdmin.get('/api/connectors/valentine')
      .then(res => {
        const cfg = {
          enabled: res.data.enabled ?? false,
          url: res.data.url || 'https://valentine.wtf',
          username: res.data.username || '',
          password: res.data.password || '',
          _hasPassword: res.data._hasPassword ?? false,
          cronInterval: res.data.cronInterval || 6,
          valentineFallbackToAdmin: res.data.valentineFallbackToAdmin ?? false,
        };
        setConfig(cfg);
        // Auto-fetch quota si activé et mot de passe configuré
        if (cfg.enabled && cfg._hasPassword) {
          axiosAdmin.get('/api/connectors/valentine/quota')
            .then(qRes => { setQuota(qRes.data); setQuotaFetchedAt(new Date()); setValentineStatus('ok'); })
            .catch(() => { setValentineStatus('error'); });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    const fetchNextScan = () => {
      axiosAdmin.get('/api/connectors/valentine/next-scan')
        .then(res => setNextScanAt(res.data.nextScanAt))
        .catch(() => {});
    };

    fetchNextScan();
    // Re-fetch toutes les 30s pour mettre à jour après passage du cron
    const id = setInterval(fetchNextScan, 30000);
    return () => clearInterval(id);
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
            <img src="https://valentine.wtf/logo.php?mode=clair" alt="Valentine" className={styles.connectorLogoValentine} />
          </div>
          <div>
            <p className={styles.cardName}>
              Valentine.wtf
              {valentineStatus && (
                <span className={valentineStatus === 'ok' ? styles.statusDotOk : styles.statusDotError} title={valentineStatus === 'ok' ? 'Connecté' : 'Connexion échouée'} />
              )}
            </p>
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

      {config.enabled && nextScanAt && (
        <div className={styles.nextScan}>
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          Prochain scan dans <strong>{countdown}</strong>
          <span className={styles.nextScanInterval}>(toutes les {config.cronInterval}h)</span>
        </div>
      )}
      {config.enabled && quota && !quota.error && (
        <div className={styles.nextScan}>
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
            <polyline points="8 17 12 21 16 17"/><line x1="12" y1="3" x2="12" y2="21"/>
          </svg>
          Quota : <strong>{quota.remaining ?? '—'}</strong>
          {quota.total != null && <span className={styles.nextScanInterval}>/ {quota.total} restants</span>}
        </div>
      )}

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
        </div>

        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel}>Intervalle de scan</label>
          <select
            className={styles.fieldInput}
            value={config.cronInterval}
            onChange={e => setConfig(c => ({ ...c, cronInterval: Number(e.target.value) }))}
          >
            <option value={1}>Toutes les heures</option>
            <option value={2}>Toutes les 2h</option>
            <option value={4}>Toutes les 4h</option>
            <option value={6}>Toutes les 6h</option>
            <option value={12}>Toutes les 12h</option>
            <option value={24}>Une fois par jour</option>
          </select>
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

        <label className={styles.toggleOptionRow}>
          <input
            type="checkbox"
            className={styles.toggleOptionCheckbox}
            checked={config.valentineFallbackToAdmin}
            onChange={async e => {
              const updated = { ...config, valentineFallbackToAdmin: e.target.checked };
              setConfig(updated);
              try { await axiosAdmin.put('/api/connectors/valentine', updated); } catch { /* silencieux */ }
            }}
          />
          <div className={styles.toggleOptionInfo}>
            <span className={styles.toggleOptionLabel}>Fallback vers ce compte si quota user épuisé</span>
            <p className={styles.toggleOptionDesc}>Si un user a son propre compte Valentine et que son quota est épuisé, retente avec le compte admin avant de passer à Anna's Archive.</p>
          </div>
        </label>

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

function AnnasArchiveCard() {
  const [config, setConfig] = useState({ enabled: false, url: 'https://annas-archive.pk', lang: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState(null);
  const [annasStatus, setAnnasStatus] = useState(null); // 'ok' | 'error' | null

  useEffect(() => {
    axiosAdmin.get('/api/connectors/annasarchive')
      .then(res => {
        const cfg = {
          enabled: res.data.enabled ?? false,
          url: res.data.url || 'https://annas-archive.pk',
          lang: res.data.lang || '',
        };
        setConfig(cfg);
        if (cfg.enabled) {
          axiosAdmin.get('/api/connectors/annasarchive/ping')
            .then(() => setAnnasStatus('ok'))
            .catch(() => setAnnasStatus('error'));
        }
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
      await axiosAdmin.put('/api/connectors/annasarchive', config);
      showAlertMsg('success', 'Configuration enregistrée.');
    } catch (err) {
      showAlertMsg('error', err.response?.data?.error || 'Erreur lors de la sauvegarde.');
    } finally {
      setSaving(false);
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
          <div className={`${styles.cardLogoWrap} ${styles.cardLogoWrapAnnas}`}>
            <span className={styles.annasLogoLetter}>A</span>
          </div>
          <div>
            <p className={styles.cardName}>
              Anna's Archive
              {annasStatus && (
                <span className={annasStatus === 'ok' ? styles.statusDotOk : styles.statusDotError} title={annasStatus === 'ok' ? 'Joignable' : 'Inaccessible'} />
              )}
            </p>
            <p className={styles.cardDesc}>Recherche et téléchargement automatique via Anna's Archive. Utilise FlareSolverr pour contourner la protection DDoS. Fallback automatique si Valentine ne trouve pas le livre.</p>
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
            placeholder="https://annas-archive.pk"
            value={config.url}
            onChange={e => setConfig(c => ({ ...c, url: e.target.value }))}
          />
          <p className={styles.fieldHint}>Miroirs de secours : annas-archive.gl · annas-archive.gd</p>
        </div>

        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel}>Langue des résultats</label>
          <select
            className={styles.fieldInput}
            value={config.lang}
            onChange={e => setConfig(c => ({ ...c, lang: e.target.value }))}
          >
            <option value="">Toutes les langues</option>
            <option value="fr">Français uniquement</option>
            <option value="en">Anglais uniquement</option>
          </select>
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

function PredbCard() {
  const [config, setConfig] = useState({
    enabled: false,
    url: 'https://api.predb.fr',
    apiKey: '',
    _hasApiKey: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [alert, setAlert] = useState(null);
  const [predbStatus, setPredbStatus] = useState(null); // 'ok' | 'error' | null

  useEffect(() => {
    axiosAdmin.get('/api/connectors/predb')
      .then(res => {
        const cfg = {
          enabled: res.data.enabled ?? false,
          url: res.data.url || 'https://api.predb.fr',
          apiKey: res.data.apiKey || '',
          _hasApiKey: res.data._hasApiKey ?? false,
        };
        setConfig(cfg);
        if (cfg.enabled && cfg._hasApiKey) {
          axiosAdmin.post('/api/connectors/predb/test', { apiKey: '••••••••', url: cfg.url })
            .then(() => setPredbStatus('ok'))
            .catch(() => setPredbStatus('error'));
        }
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
      await axiosAdmin.put('/api/connectors/predb', config);
      showAlertMsg('success', 'Configuration enregistrée.');
    } catch (err) {
      showAlertMsg('error', err.response?.data?.error || 'Erreur lors de la sauvegarde.');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!config.apiKey && !config._hasApiKey) {
      showAlertMsg('error', 'Renseignez la clé API avant de tester.');
      return;
    }
    setTesting(true);
    setAlert(null);
    try {
      const res = await axiosAdmin.post('/api/connectors/predb/test', {
        apiKey: config.apiKey,
        url: config.url,
      });
      showAlertMsg('success', res.data.message || 'Connexion réussie !');
      setPredbStatus('ok');
    } catch (err) {
      showAlertMsg('error', err.response?.data?.error || 'Connexion impossible.');
      setPredbStatus('error');
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
              <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4.03 3-9 3S3 13.66 3 12"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/>
            </svg>
          </div>
          <div>
            <p className={styles.cardName}>
              PreDB.fr
              {predbStatus && (
                <span className={predbStatus === 'ok' ? styles.statusDotOk : styles.statusDotError} title={predbStatus === 'ok' ? 'Connecté' : 'Connexion échouée'} />
              )}
            </p>
            <p className={styles.cardDesc}>Vérifie la disponibilité des ebooks via l'API predb.fr. Utilisé en parallèle du flux RSS predb.me pour améliorer la détection.</p>
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
          <label className={styles.fieldLabel}>URL de l'API</label>
          <input
            className={styles.fieldInput}
            type="url"
            placeholder="https://api.predb.fr"
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
              placeholder={config._hasApiKey ? '••••••••' : 'Votre clé API predb.fr'}
              value={config.apiKey}
              autoComplete="new-password"
              onChange={e => setConfig(c => ({ ...c, apiKey: e.target.value }))}
            />
            <button type="button" className={styles.eyeBtn} onClick={() => setShowKey(v => !v)} title={showKey ? 'Masquer' : 'Afficher'}>
              <EyeIcon open={showKey} />
            </button>
          </div>
          {config._hasApiKey && !config.apiKey && (
            <p className={styles.fieldHint}>Clé API déjà enregistrée — laisser vide pour conserver.</p>
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

      <ValentineCard />
      <AnnasArchiveCard />
      <PredbCard />
    </div>
  );
}