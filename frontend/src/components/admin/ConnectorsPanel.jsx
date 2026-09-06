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
    directSearchEnabled: true,
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
          directSearchEnabled: res.data.directSearchEnabled ?? true,
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

        <label className={styles.toggleOptionRow}>
          <input
            type="checkbox"
            className={styles.toggleOptionCheckbox}
            checked={config.directSearchEnabled}
            onChange={async e => {
              const updated = { ...config, directSearchEnabled: e.target.checked };
              setConfig(updated);
              try { await axiosAdmin.put('/api/connectors/valentine', updated); } catch { /* silencieux */ }
            }}
          />
          <div className={styles.toggleOptionInfo}>
            <span className={styles.toggleOptionLabel}>Recherche directe sur Valentine (bypass Google Books)</span>
            <p className={styles.toggleOptionDesc}>Permet aux users de chercher et télécharger directement sur Valentine, sans passer par Google Books/Open Library/Hardcover.</p>
          </div>
        </label>

        {config.directSearchEnabled && (
          <div className={styles.solverWarning}>
            <AlertIcon />
            <span>
              <strong>Risque de ban de compte.</strong> La recherche directe multiplie les
              échanges avec Valentine (recherches, navigation par auteur/série) par rapport
              au flux classique via Google Books. Si le compte a déjà été suspendu par le
              passé, ou en cas de doute, désactive cette option.
            </span>
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

function AnnasArchiveCard() {
  const [config, setConfig] = useState({ enabled: false, url: 'https://annas-archive.pk', lang: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState(null);
  const [annasStatus, setAnnasStatus] = useState(null); // 'ok' | 'error' | null
  const [annasSearchable, setAnnasSearchable] = useState(true);

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
            .then(r => {
              setAnnasStatus('ok');
              // Le site répond mais /search est challengé : recherche et téléchargement
              // automatique sont hors service, seul l'accès manuel fonctionne.
              setAnnasSearchable(r.data.searchable !== false);
            })
            .catch(() => { setAnnasStatus('error'); setAnnasSearchable(false); });
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
            <p className={styles.cardDesc}>Recherche et téléchargement automatique via Anna's Archive, en repli si Valentine ne trouve pas le livre. Tente de franchir la protection DDoS-Guard via le solveur, sans succès actuellement : LibGen prend alors le relais.</p>
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

      {config.enabled && annasStatus === 'ok' && !annasSearchable && (
        <div className={styles.solverWarning}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '0.1rem' }}>
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
          <span>
            Le site répond, mais sa protection anti-bot (DDoS-Guard) bloque les requêtes
            automatisées et le solveur ne parvient pas à la résoudre.
            <strong> La recherche et le téléchargement automatique sont indisponibles.</strong>
            {' '}L'accès manuel depuis un navigateur fonctionne toujours, et LibGen prend le
            relais s'il est activé.
          </span>
        </div>
      )}

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

function LibgenCard() {
  const [config, setConfig] = useState({ enabled: false, url: 'https://libgen.li' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState(null);
  const [status, setStatus] = useState(null); // 'ok' | 'error' | null

  useEffect(() => {
    axiosAdmin.get('/api/connectors/libgen')
      .then(res => {
        const cfg = {
          enabled: res.data.enabled ?? false,
          url: res.data.url || 'https://libgen.li',
        };
        setConfig(cfg);
        if (cfg.enabled) {
          axiosAdmin.get('/api/connectors/libgen/ping')
            .then(() => setStatus('ok'))
            .catch(() => setStatus('error'));
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
      await axiosAdmin.put('/api/connectors/libgen', config);
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
            <span className={styles.annasLogoLetter}>L</span>
          </div>
          <div>
            <p className={styles.cardName}>
              LibGen
              {status && (
                <span className={status === 'ok' ? styles.statusDotOk : styles.statusDotError} title={status === 'ok' ? 'Joignable' : 'Inaccessible'} />
              )}
            </p>
            <p className={styles.cardDesc}>Repli lorsque Anna's Archive est inaccessible (protection DDoS-Guard) : LibGen n'a aucun challenge anti-bot et partage les mêmes empreintes MD5. Couvre les romans et ouvrages, mais pas la BD ni les comics.</p>
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
            placeholder="https://libgen.li"
            value={config.url}
            onChange={e => setConfig(c => ({ ...c, url: e.target.value }))}
          />
          <p className={styles.fieldHint}>Miroirs de secours : libgen.vg · libgen.la · libgen.bz · libgen.gl</p>
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

function TrendingCard() {
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axiosAdmin.get('/api/connectors/trending')
      .then(res => setEnabled(res.data.preloadOnStartup !== false))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null;

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardBrand}>
          <div className={`${styles.cardLogoWrap} ${styles.cardLogoWrapAnnas}`}>
            <span className={styles.annasLogoLetter}>D</span>
          </div>
          <div>
            <p className={styles.cardName}>Découvrir</p>
            <p className={styles.cardDesc}>
              Précharge les 7 catégories de la page "Découvrir" au démarrage du serveur, pour qu'elle
              réponde instantanément dès la première visite. Coûte jusqu'à ~70 requêtes Google Books
              à chaque redémarrage du conteneur (mise à jour, crash, reboot…), même si personne ne
              consulte la page ce jour-là. Désactiver ici la fait charger à la demande à la place :
              la première visite du jour absorbe un léger délai, mais zéro requête gaspillée si
              personne n'y va.
            </p>
          </div>
        </div>
        <label className={styles.switch}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={async e => {
              const next = e.target.checked;
              setEnabled(next);
              try { await axiosAdmin.put('/api/connectors/trending', { preloadOnStartup: next }); } catch { /* silencieux */ }
            }}
          />
          <span className={styles.slider} />
        </label>
      </div>
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
      <LibgenCard />
      <TrendingCard />
    </div>
  );
}