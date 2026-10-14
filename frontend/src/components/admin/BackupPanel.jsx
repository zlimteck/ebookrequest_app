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
  const [exportPassword, setExportPassword] = useState('');
  const [confirmModal, setConfirmModal] = useState(null); // File en attente de confirmation
  const [confirmInput, setConfirmInput] = useState('');
  const [restorePassword, setRestorePassword] = useState('');
  const [lastRestoreAt, setLastRestoreAt] = useState(null);
  const fileInputRef = React.useRef(null);

  useEffect(() => {
    axiosAdmin.get('/api/admin/backup/auto-config')
      .then(res => setLastRestoreAt(res.data?.lastRestoreAt || null))
      .catch(() => {});
  }, []);

  const showAlertMsg = (type, message) => {
    setAlert({ type, message });
    setTimeout(() => setAlert(null), 8000);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await axiosAdmin.post('/api/admin/backup/export', { password: exportPassword || undefined }, {
        responseType: 'blob', timeout: 120000,
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `ebookrequest-backup-${new Date().toISOString().slice(0, 10)}.zip${exportPassword ? '.enc' : ''}`;
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
    setRestorePassword('');
    e.target.value = '';
  };

  const handleRestore = async () => {
    if (!confirmModal) return;
    setRestoring(true);
    try {
      const formData = new FormData();
      formData.append('file', confirmModal);
      if (restorePassword) formData.append('password', restorePassword);
      const res = await axiosAdmin.post('/api/admin/backup/restore', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      });
      setConfirmModal(null);
      const r = res.data;
      setLastRestoreAt(r.lastRestoreAt || new Date().toISOString());
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
        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel}>Mot de passe de protection (optionnel)</label>
          <input
            type="password"
            className={styles.fieldInput}
            placeholder="Laisser vide pour un zip non protégé"
            value={exportPassword}
            autoComplete="new-password"
            onChange={e => setExportPassword(e.target.value)}
          />
          <p className={styles.fieldHint}>
            Si renseigné, le fichier est chiffré (AES-256) et illisible sans ce mot de passe, y compris par
            vous-même en cas d'oubli, il n'est jamais stocké nulle part.
          </p>
        </div>

        <div className={styles.cardActions}>
          <button type="button" className={styles.btnPrimary} onClick={handleExport} disabled={exporting}>
            {exporting ? 'Export en cours…' : 'Exporter les données'}
          </button>
          <button type="button" className={styles.btnTest} onClick={() => fileInputRef.current?.click()} disabled={restoring}>
            Restaurer depuis un fichier...
          </button>
          <input ref={fileInputRef} type="file" accept=".zip,.enc" style={{ display: 'none' }} onChange={handleFileSelected} />
        </div>

        {lastRestoreAt && (
          <p className={styles.fieldHint}>
            Dernière restauration : {new Date(lastRestoreAt).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </p>
        )}

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
              <p>
                <strong>Si cette sauvegarde vient d'une autre instance</strong> (ou si le fichier <code>.env</code> a changé
                depuis), assurez-vous d'avoir le <strong>JWT_SECRET</strong> d'origine à portée de main : les secrets
                chiffrés qu'elle contient (connecteurs, comptes Valentine/Hardcover...) ne redeviennent lisibles
                qu'avec la même clé que celle utilisée à l'export. Sans elle, ils resteront simplement vides après
                la restauration, à ressaisir manuellement.
              </p>
              <input
                type="password"
                className={styles.dangerModalInput}
                value={restorePassword}
                onChange={e => setRestorePassword(e.target.value)}
                placeholder="Mot de passe (si ce fichier en a un)"
                autoComplete="new-password"
                disabled={restoring}
                style={{ marginBottom: '0.75rem' }}
              />
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
    backupEncryptionPassword: '', _hasBackupEncryptionPassword: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [runningNow, setRunningNow] = useState(false);
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

  const handleSavePassword = async () => {
    setSavingPassword(true);
    try {
      await axiosAdmin.put('/api/admin/backup/auto-config', config);
      showAlertMsg('success', 'Mot de passe enregistré.');
      setConfig(c => ({ ...c, _hasBackupEncryptionPassword: !!c.backupEncryptionPassword || c._hasBackupEncryptionPassword, backupEncryptionPassword: '' }));
    } catch (err) {
      showAlertMsg('error', 'Erreur lors de la sauvegarde du mot de passe.');
    } finally {
      setSavingPassword(false);
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

        <div className={styles.fieldRow}>
          <label className={styles.fieldLabel}>Mot de passe de protection (optionnel)</label>
          <input
            type="password"
            className={styles.fieldInput}
            placeholder={config._hasBackupEncryptionPassword ? '••••••••' : 'Laisser vide pour des zips non protégés'}
            value={config.backupEncryptionPassword}
            autoComplete="new-password"
            onChange={e => setConfig(c => ({ ...c, backupEncryptionPassword: e.target.value }))}
          />
          <p className={styles.fieldHint}>
            Si renseigné, chaque sauvegarde générée automatiquement (locale et sur chaque destination distante) est
            chiffrée (AES-256) avec ce mot de passe, stocké chiffré sur cette instance, à retenir séparément pour
            pouvoir restaurer plus tard.
          </p>
          <div className={styles.cardActions}>
            <button type="button" className={styles.btnPrimary} onClick={handleSavePassword} disabled={savingPassword}>
              {savingPassword ? 'Enregistrement…' : 'Enregistrer le mot de passe'}
            </button>
          </div>
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

const EMPTY_DESTINATION = {
  id: null,
  type: 'webdav',
  label: '',
  enabled: true,
  webdavUrl: '', webdavUsername: '', webdavPassword: '', _hasWebdavPassword: false,
  s3Endpoint: '', s3Bucket: '', s3Region: 'auto', s3AccessKeyId: '', s3Prefix: '',
  s3SecretAccessKey: '', _hasS3SecretAccessKey: false,
};

function DestinationsCard() {
  const [destinations, setDestinations] = useState(null); // null = pas encore chargé
  const [modal, setModal] = useState(null); // destination en édition/création
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [modalAlert, setModalAlert] = useState(null);

  const loadDestinations = () => {
    axiosAdmin.get('/api/admin/backup/destinations')
      .then(res => setDestinations(res.data.destinations || []))
      .catch(() => setDestinations([]));
  };

  useEffect(() => { loadDestinations(); }, []);

  const openCreateModal = () => { setModal({ ...EMPTY_DESTINATION }); setModalAlert(null); };
  const openEditModal = (dest) => { setModal({ ...EMPTY_DESTINATION, ...dest }); setModalAlert(null); };

  const showModalAlert = (type, message) => setModalAlert({ type, message });

  const toggleEnabled = async (dest) => {
    try {
      await axiosAdmin.put(`/api/admin/backup/destinations/${dest.id}`, { ...dest, enabled: !dest.enabled });
      loadDestinations();
    } catch (err) {
      // silencieux, le toggle reste dans son état précédent côté UI au prochain reload
    }
  };

  const handleSaveModal = async () => {
    setSaving(true);
    try {
      if (modal.id) {
        await axiosAdmin.put(`/api/admin/backup/destinations/${modal.id}`, modal);
      } else {
        await axiosAdmin.post('/api/admin/backup/destinations', modal);
      }
      setModal(null);
      loadDestinations();
    } catch (err) {
      showModalAlert('error', err.response?.data?.error || 'Erreur lors de la sauvegarde.');
    } finally {
      setSaving(false);
    }
  };

  const handleTestModal = async () => {
    setTesting(true);
    try {
      await axiosAdmin.post('/api/admin/backup/destinations/test', modal);
      showModalAlert('success', 'Connexion réussie.');
    } catch (err) {
      showModalAlert('error', err.response?.data?.error || 'Connexion impossible.');
    } finally {
      setTesting(false);
    }
  };

  const handleDeleteModal = async () => {
    if (!modal.id) return;
    setDeleting(true);
    try {
      await axiosAdmin.delete(`/api/admin/backup/destinations/${modal.id}`);
      setModal(null);
      loadDestinations();
    } catch (err) {
      showModalAlert('error', 'Erreur lors de la suppression.');
    } finally {
      setDeleting(false);
    }
  };

  if (destinations === null) return (
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
              <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
            </svg>
          </div>
          <div>
            <p className={styles.cardName}>Destinations distantes</p>
            <p className={styles.cardDesc}>
              Chaque sauvegarde automatique est envoyée vers toutes les destinations activées ci-dessous, en plus
              de la copie locale. WebDAV ou S3-compatible (Hetzner Object Storage, Backblaze B2, MinIO,
              SeaweedFS...), autant de destinations que besoin.
            </p>
          </div>
        </div>
      </div>

      <div className={styles.form}>
        <div className={styles.fieldRow}>
          {destinations.length === 0 ? (
            <p className={styles.fieldHint}>Aucune destination configurée.</p>
          ) : (
            <div className={styles.miniCardGrid}>
              {destinations.map(d => (
                <div
                  key={d.id}
                  className={`${styles.miniCard} ${styles.miniCardClickable} ${!d.enabled ? styles.miniCardDisabled : ''}`}
                  onClick={() => openEditModal(d)}
                  title="Cliquer pour modifier"
                >
                  <span
                    className={`${styles.miniCardDot} ${d.enabled ? styles.miniCardDotOn : ''}`}
                    onClick={(e) => { e.stopPropagation(); toggleEnabled(d); }}
                    title={d.enabled ? 'Désactiver' : 'Activer'}
                  />
                  <div className={styles.miniCardBody}>
                    <div className={styles.miniCardName} title={d.label || d.type}>
                      {d.label || (d.type === 's3' ? 'S3' : 'WebDAV')}
                    </div>
                    <div className={styles.miniCardMeta} title={d.type === 's3' ? d.s3Bucket : d.webdavUrl}>
                      {d.type === 's3' ? (d.s3Bucket || 'Bucket non configuré') : (d.webdavUrl || 'URL non configurée')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={styles.cardActions}>
          <button type="button" className={styles.btnPrimary} onClick={openCreateModal}>
            + Ajouter une destination
          </button>
        </div>
      </div>

      {modal && (
        <div className={styles.catModalOverlay} onClick={() => !saving && setModal(null)}>
          <div className={styles.catModal} onClick={e => e.stopPropagation()}>
            <div className={styles.catModalHeader}>
              <div>
                <p className={styles.catModalTitle}>{modal.id ? 'Modifier la destination' : 'Nouvelle destination'}</p>
                <p className={styles.catModalSubtitle}>WebDAV ou S3-compatible, utilisé pour chaque sauvegarde automatique.</p>
              </div>
              <button type="button" className={styles.catModalClose} onClick={() => setModal(null)}>×</button>
            </div>
            <div className={styles.catModalBody}>
              <label className={styles.toggleOptionRow} style={{ borderTop: 'none', paddingTop: 0 }}>
                <input
                  type="checkbox"
                  className={styles.toggleOptionCheckbox}
                  checked={modal.enabled}
                  onChange={e => setModal(m => ({ ...m, enabled: e.target.checked }))}
                />
                <div className={styles.toggleOptionInfo}>
                  <span className={styles.toggleOptionLabel}>Activée</span>
                  <p className={styles.toggleOptionDesc}>Une destination désactivée est ignorée par le cron automatique.</p>
                </div>
              </label>

              <div className={styles.fieldRow}>
                <label className={styles.fieldLabel}>Nom (optionnel)</label>
                <input
                  className={styles.fieldInput}
                  type="text"
                  placeholder="Ex: Hetzner prod"
                  value={modal.label}
                  onChange={e => setModal(m => ({ ...m, label: e.target.value }))}
                />
              </div>

              <div className={styles.fieldRow}>
                <label className={styles.fieldLabel}>Type</label>
                <select
                  className={styles.fieldInput}
                  value={modal.type}
                  onChange={e => setModal(m => ({ ...m, type: e.target.value }))}
                >
                  <option value="webdav">WebDAV</option>
                  <option value="s3">S3 compatible</option>
                </select>
              </div>

              {modal.type === 'webdav' && (
                <>
                  <div className={styles.fieldRow}>
                    <label className={styles.fieldLabel}>URL WebDAV</label>
                    <input
                      className={styles.fieldInput}
                      type="text"
                      placeholder="https://u123.your-storagebox.de/backups"
                      value={modal.webdavUrl}
                      onChange={e => setModal(m => ({ ...m, webdavUrl: e.target.value }))}
                    />
                  </div>
                  <div className={styles.fieldRow}>
                    <label className={styles.fieldLabel}>Utilisateur</label>
                    <input
                      className={styles.fieldInput}
                      type="text"
                      autoComplete="off"
                      value={modal.webdavUsername}
                      onChange={e => setModal(m => ({ ...m, webdavUsername: e.target.value }))}
                    />
                  </div>
                  <div className={styles.fieldRow}>
                    <label className={styles.fieldLabel}>Mot de passe</label>
                    <input
                      className={styles.fieldInput}
                      type="password"
                      autoComplete="off"
                      placeholder={modal._hasWebdavPassword ? '••••••••' : ''}
                      value={modal.webdavPassword}
                      onChange={e => setModal(m => ({ ...m, webdavPassword: e.target.value }))}
                    />
                  </div>
                </>
              )}

              {modal.type === 's3' && (
                <>
                  <div className={styles.fieldRow}>
                    <label className={styles.fieldLabel}>Endpoint</label>
                    <input
                      className={styles.fieldInput}
                      type="text"
                      placeholder="https://fsn1.your-objectstorage.com"
                      value={modal.s3Endpoint}
                      onChange={e => setModal(m => ({ ...m, s3Endpoint: e.target.value }))}
                    />
                  </div>
                  <div className={styles.fieldRow}>
                    <label className={styles.fieldLabel}>Bucket</label>
                    <input
                      className={styles.fieldInput}
                      type="text"
                      value={modal.s3Bucket}
                      onChange={e => setModal(m => ({ ...m, s3Bucket: e.target.value }))}
                    />
                  </div>
                  <div className={styles.fieldRow}>
                    <label className={styles.fieldLabel}>Dossier / Préfixe (optionnel)</label>
                    <input
                      className={styles.fieldInput}
                      type="text"
                      placeholder="db/"
                      value={modal.s3Prefix}
                      onChange={e => setModal(m => ({ ...m, s3Prefix: e.target.value }))}
                    />
                    <p className={styles.fieldHint}>Les sauvegardes seront rangées dans ce sous-dossier du bucket plutôt qu'à la racine.</p>
                  </div>
                  <div className={styles.fieldRow}>
                    <label className={styles.fieldLabel}>Région</label>
                    <input
                      className={styles.fieldInput}
                      type="text"
                      value={modal.s3Region}
                      onChange={e => setModal(m => ({ ...m, s3Region: e.target.value }))}
                    />
                  </div>
                  <div className={styles.fieldRow}>
                    <label className={styles.fieldLabel}>Access Key ID</label>
                    <input
                      className={styles.fieldInput}
                      type="text"
                      autoComplete="off"
                      value={modal.s3AccessKeyId}
                      onChange={e => setModal(m => ({ ...m, s3AccessKeyId: e.target.value }))}
                    />
                  </div>
                  <div className={styles.fieldRow}>
                    <label className={styles.fieldLabel}>Secret Access Key</label>
                    <input
                      className={styles.fieldInput}
                      type="password"
                      autoComplete="off"
                      placeholder={modal._hasS3SecretAccessKey ? '••••••••' : ''}
                      value={modal.s3SecretAccessKey}
                      onChange={e => setModal(m => ({ ...m, s3SecretAccessKey: e.target.value }))}
                    />
                  </div>
                </>
              )}

              {modalAlert && (
                <div className={`${styles.alert} ${modalAlert.type === 'success' ? styles.alertSuccess : styles.alertError}`}>
                  {modalAlert.type === 'success' ? <CheckIcon /> : <AlertIcon />}
                  {modalAlert.message}
                </div>
              )}
            </div>
            <div className={styles.catModalFooter}>
              {modal.id && (
                <button type="button" className={styles.btnTest} onClick={handleDeleteModal} disabled={deleting || saving}>
                  {deleting ? 'Suppression…' : 'Supprimer'}
                </button>
              )}
              <button type="button" className={styles.btnTest} onClick={handleTestModal} disabled={testing || saving}>
                {testing ? 'Test en cours…' : 'Tester la connexion'}
              </button>
              <button type="button" className={styles.btnPrimary} onClick={handleSaveModal} disabled={saving}>
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}
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
      <DestinationsCard />
    </div>
  );
}
