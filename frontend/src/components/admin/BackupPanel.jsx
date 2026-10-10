import React, { useState, useEffect } from 'react';
import axiosAdmin from '../../axiosAdmin';
import styles from './ConnectorsPanel.module.css';
import fstyles from './FileManagerPanel.module.css';

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

function BackupCard() {
  const [exporting, setExporting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [alert, setAlert] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null); // File en attente de confirmation
  const [confirmInput, setConfirmInput] = useState('');
  const fileInputRef = React.useRef(null);

  const showAlertMsg = (type, message) => {
    setAlert({ type, message });
    setTimeout(() => setAlert(null), 8000);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await axiosAdmin.get('/api/admin/backup/export', { responseType: 'blob', timeout: 120000 });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `ebookrequest-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      showAlertMsg('error', "Erreur lors de la génération de la sauvegarde.");
    } finally {
      setExporting(false);
    }
  };

  const handleFileSelected = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setConfirmModal(file);
    setConfirmInput('');
    e.target.value = '';
  };

  const handleRestore = async () => {
    if (!confirmModal) return;
    setRestoring(true);
    try {
      const formData = new FormData();
      formData.append('file', confirmModal);
      const res = await axiosAdmin.post('/api/admin/backup/restore', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      });
      setConfirmModal(null);
      const r = res.data;
      showAlertMsg('success',
        `Restauration terminée (sauvegarde du ${new Date(r.exportedAt).toLocaleString('fr-FR')}).${r.versionMismatch ? ' Attention : version différente de celle actuelle, vérifiez que tout fonctionne correctement.' : ''}`
      );
    } catch (err) {
      showAlertMsg('error', err.response?.data?.error || 'Erreur lors de la restauration.');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardBrand}>
          <div className={styles.cardLogoWrap}>
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/>
            </svg>
          </div>
          <div>
            <p className={styles.cardName}>Sauvegarde</p>
            <p className={styles.cardDesc}>
              Export/restauration des données de l'instance (demandes, utilisateurs, réglages, connecteurs...) en
              zip. Les secrets chiffrés restent chiffrés dans le fichier (pas de fuite en clair) ; ceux stockés en
              clair (Apprise, Pushover) sont exclus et à ressaisir après une restauration. Les fichiers ebooks ne
              sont pas concernés (volume Docker).
            </p>
          </div>
        </div>
      </div>

      <div className={styles.form}>
        <div className={styles.cardActions}>
          <button type="button" className={styles.btnPrimary} onClick={handleExport} disabled={exporting}>
            {exporting ? 'Export en cours…' : 'Exporter les données'}
          </button>
          <button type="button" className={styles.btnTest} onClick={() => fileInputRef.current?.click()} disabled={restoring}>
            Restaurer depuis un fichier...
          </button>
          <input ref={fileInputRef} type="file" accept=".zip" style={{ display: 'none' }} onChange={handleFileSelected} />
        </div>

        {alert && (
          <div className={`${styles.alert} ${alert.type === 'success' ? styles.alertSuccess : styles.alertError}`}>
            {alert.type === 'success' ? <CheckIcon /> : <AlertIcon />}
            {alert.message}
          </div>
        )}
      </div>

      {confirmModal && (
        <div className={styles.dangerModalOverlay} onClick={() => !restoring && setConfirmModal(null)}>
          <div className={styles.dangerModal} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Restaurer une sauvegarde">
            <div className={styles.dangerModalHeader}>
              <AlertIcon />
              Restaurer une sauvegarde
            </div>
            <div className={styles.dangerModalBody}>
              <p>
                <strong>Action irréversible.</strong> Toutes les données actuelles (demandes, utilisateurs, réglages...)
                seront remplacées par le contenu de « {confirmModal.name} ». Les secrets Apprise/Pushover devront
                être ressaisis après coup (stockés en clair, jamais inclus dans la sauvegarde).
              </p>
              <p>Pour confirmer, tapez <strong style={{ color: 'var(--color-text)' }}>restaurer</strong> ci-dessous.</p>
              <input
                type="text"
                className={styles.dangerModalInput}
                value={confirmInput}
                onChange={e => setConfirmInput(e.target.value)}
                placeholder="restaurer"
                disabled={restoring}
                autoFocus
              />
            </div>
            <div className={styles.dangerModalFooter}>
              <button type="button" className={styles.dangerModalCancelBtn} onClick={() => setConfirmModal(null)} disabled={restoring}>
                Annuler
              </button>
              <button
                type="button"
                className={styles.dangerModalConfirmBtn}
                onClick={handleRestore}
                disabled={restoring || confirmInput.trim().toLowerCase() !== 'restaurer'}
              >
                {restoring ? 'Restauration…' : 'Restaurer définitivement'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes) {
  if (!bytes) return '0 Ko';
  const units = ['o', 'Ko', 'Mo', 'Go'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function AutoBackupCard() {
  const [config, setConfig] = useState({
    enabled: false, cronInterval: 24, backupRetentionCount: 7,
    remoteBackupType: '', remoteBackupWebdavUrl: '', remoteBackupWebdavUsername: '',
    remoteBackupWebdavPassword: '', _hasRemoteBackupWebdavPassword: false,
    remoteBackupS3Endpoint: '', remoteBackupS3Bucket: '', remoteBackupS3Region: 'auto',
    remoteBackupS3AccessKeyId: '', remoteBackupS3SecretAccessKey: '', _hasRemoteBackupS3SecretAccessKey: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runningNow, setRunningNow] = useState(false);
  const [testingRemote, setTestingRemote] = useState(false);
  const [remoteAlert, setRemoteAlert] = useState(null);
  const [backups, setBackups] = useState([]);
  const [alert, setAlert] = useState(null);

  const showAlertMsg = (type, message) => {
    setAlert({ type, message });
    setTimeout(() => setAlert(null), 8000);
  };

  const loadHistory = () => {
    axiosAdmin.get('/api/admin/backup/history')
      .then(res => setBackups(res.data.backups || []))
      .catch(() => {});
  };

  useEffect(() => {
    axiosAdmin.get('/api/admin/backup/auto-config')
      .then(res => setConfig(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
    loadHistory();
  }, []);

  const handleSave = async (next) => {
    setConfig(next);
    setSaving(true);
    try {
      await axiosAdmin.put('/api/admin/backup/auto-config', next);
    } catch (err) {
      showAlertMsg('error', 'Erreur lors de la sauvegarde du réglage.');
    } finally {
      setSaving(false);
    }
  };

  const handleRunNow = async () => {
    setRunningNow(true);
    try {
      await axiosAdmin.post('/api/admin/backup/auto-run-now', {}, { timeout: 120000 });
      showAlertMsg('success', 'Sauvegarde générée.');
      loadHistory();
    } catch (err) {
      showAlertMsg('error', 'Erreur lors de la génération de la sauvegarde.');
    } finally {
      setRunningNow(false);
    }
  };

  const handleDelete = async (filename) => {
    try {
      await axiosAdmin.delete(`/api/admin/backup/history/${filename}`);
      loadHistory();
    } catch (err) {
      showAlertMsg('error', 'Erreur lors de la suppression.');
    }
  };

  const handleDownload = (filename) => {
    window.open(`${axiosAdmin.defaults.baseURL || ''}/api/admin/backup/history/${filename}`, '_blank');
  };

  const showRemoteAlertMsg = (type, message) => {
    setRemoteAlert({ type, message });
    setTimeout(() => setRemoteAlert(null), 8000);
  };

  const handleSaveRemote = async () => {
    setSaving(true);
    try {
      await axiosAdmin.put('/api/admin/backup/auto-config', config);
      showRemoteAlertMsg('success', 'Destination distante enregistrée.');
    } catch (err) {
      showRemoteAlertMsg('error', 'Erreur lors de la sauvegarde.');
    } finally {
      setSaving(false);
    }
  };

  const handleTestRemote = async () => {
    setTestingRemote(true);
    try {
      await axiosAdmin.post('/api/admin/backup/remote/test', config);
      showRemoteAlertMsg('success', 'Connexion réussie.');
    } catch (err) {
      showRemoteAlertMsg('error', err.response?.data?.error || 'Connexion impossible.');
    } finally {
      setTestingRemote(false);
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
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
          </div>
          <div>
            <p className={styles.cardName}>Sauvegarde automatique</p>
            <p className={styles.cardDesc}>
              Génère une sauvegarde périodique sur le volume de l'instance (uploads/backups/), avec rétention des
              N plus récentes. Désactivée par défaut.
            </p>
          </div>
        </div>
        <label className={styles.switch}>
          <input type="checkbox" checked={config.enabled} onChange={e => handleSave({ ...config, enabled: e.target.checked })} disabled={saving} />
          <span className={styles.slider} />
        </label>
      </div>

      <div className={styles.form}>
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel}>Intervalle</label>
          <select
            className={styles.fieldInput}
            value={config.cronInterval}
            onChange={e => handleSave({ ...config, cronInterval: Number(e.target.value) })}
            disabled={saving}
          >
            <option value={6}>Toutes les 6h</option>
            <option value={12}>Toutes les 12h</option>
            <option value={24}>Une fois par jour</option>
            <option value={168}>Une fois par semaine</option>
          </select>
        </div>

        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel}>Sauvegardes conservées</label>
          <input
            className={styles.fieldInput}
            type="number"
            min={1}
            value={config.backupRetentionCount}
            onChange={e => setConfig(c => ({ ...c, backupRetentionCount: Number(e.target.value) }))}
            onBlur={() => handleSave(config)}
            disabled={saving}
          />
        </div>

        {alert && (
          <div className={`${styles.alert} ${alert.type === 'success' ? styles.alertSuccess : styles.alertError}`}>
            {alert.type === 'success' ? <CheckIcon /> : <AlertIcon />}
            {alert.message}
          </div>
        )}

        <div className={styles.cardActions}>
          <button type="button" className={styles.btnTest} onClick={handleRunNow} disabled={runningNow}>
            {runningNow ? 'Génération en cours…' : 'Générer une sauvegarde maintenant'}
          </button>
        </div>

        <div className={styles.fieldRow} style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1rem', marginTop: '0.25rem' }}>
          <label className={styles.fieldLabel}>Destination distante (optionnel)</label>
          <select
            className={styles.fieldInput}
            value={config.remoteBackupType}
            onChange={e => setConfig(c => ({ ...c, remoteBackupType: e.target.value }))}
          >
            <option value="">Aucune, locale uniquement</option>
            <option value="webdav">WebDAV</option>
            <option value="s3">S3 compatible</option>
          </select>
        </div>

        {config.remoteBackupType === 'webdav' && (
          <>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel}>URL WebDAV</label>
              <input
                className={styles.fieldInput}
                type="text"
                placeholder="https://u123.your-storagebox.de/backups"
                value={config.remoteBackupWebdavUrl}
                onChange={e => setConfig(c => ({ ...c, remoteBackupWebdavUrl: e.target.value }))}
              />
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel}>Utilisateur</label>
              <input
                className={styles.fieldInput}
                type="text"
                value={config.remoteBackupWebdavUsername}
                autoComplete="off"
                onChange={e => setConfig(c => ({ ...c, remoteBackupWebdavUsername: e.target.value }))}
              />
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel}>Mot de passe</label>
              <input
                className={styles.fieldInput}
                type="password"
                placeholder={config._hasRemoteBackupWebdavPassword ? '••••••••' : ''}
                value={config.remoteBackupWebdavPassword}
                autoComplete="off"
                onChange={e => setConfig(c => ({ ...c, remoteBackupWebdavPassword: e.target.value }))}
              />
            </div>
          </>
        )}

        {config.remoteBackupType === 's3' && (
          <>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel}>Endpoint</label>
              <input
                className={styles.fieldInput}
                type="text"
                placeholder="https://fsn1.your-objectstorage.com"
                value={config.remoteBackupS3Endpoint}
                onChange={e => setConfig(c => ({ ...c, remoteBackupS3Endpoint: e.target.value }))}
              />
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel}>Bucket</label>
              <input
                className={styles.fieldInput}
                type="text"
                value={config.remoteBackupS3Bucket}
                onChange={e => setConfig(c => ({ ...c, remoteBackupS3Bucket: e.target.value }))}
              />
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel}>Région</label>
              <input
                className={styles.fieldInput}
                type="text"
                value={config.remoteBackupS3Region}
                onChange={e => setConfig(c => ({ ...c, remoteBackupS3Region: e.target.value }))}
              />
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel}>Access Key ID</label>
              <input
                className={styles.fieldInput}
                type="text"
                autoComplete="off"
                value={config.remoteBackupS3AccessKeyId}
                onChange={e => setConfig(c => ({ ...c, remoteBackupS3AccessKeyId: e.target.value }))}
              />
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel}>Secret Access Key</label>
              <input
                className={styles.fieldInput}
                type="password"
                placeholder={config._hasRemoteBackupS3SecretAccessKey ? '••••••••' : ''}
                value={config.remoteBackupS3SecretAccessKey}
                autoComplete="off"
                onChange={e => setConfig(c => ({ ...c, remoteBackupS3SecretAccessKey: e.target.value }))}
              />
            </div>
          </>
        )}

        {remoteAlert && (
          <div className={`${styles.alert} ${remoteAlert.type === 'success' ? styles.alertSuccess : styles.alertError}`}>
            {remoteAlert.type === 'success' ? <CheckIcon /> : <AlertIcon />}
            {remoteAlert.message}
          </div>
        )}

        {config.remoteBackupType && (
          <div className={styles.cardActions}>
            <button type="button" className={styles.btnTest} onClick={handleTestRemote} disabled={testingRemote}>
              {testingRemote ? 'Test en cours…' : 'Tester la connexion'}
            </button>
            <button type="button" className={styles.btnPrimary} onClick={handleSaveRemote} disabled={saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        )}

        {backups.length > 0 && (
          <div className={fstyles.fileList}>
            {backups.map(b => (
              <div key={b.filename} className={fstyles.fileRow}>
                <div className={fstyles.fileRowInfo}>
                  <p className={fstyles.fileRowLabel}>{b.filename}</p>
                  <p className={fstyles.fileRowMeta}>{formatBytes(b.size)} · {new Date(b.createdAt).toLocaleString('fr-FR')}</p>
                </div>
                <div className={fstyles.fileRowActions}>
                  <button type="button" className={styles.btnTest} onClick={() => handleDownload(b.filename)}>Télécharger</button>
                  <button type="button" className={styles.btnTest} onClick={() => handleDelete(b.filename)}>Supprimer</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function BackupPanel() {
  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/>
          </svg>
          Sauvegarde
        </h2>
        <p className={styles.panelSubtitle}>Export et restauration des données de l'instance.</p>
      </div>

      <BackupCard />
      <AutoBackupCard />
    </div>
  );
}
