import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import axiosAdmin from '../../axiosAdmin';
import { shouldChunk, uploadFileChunked } from '../../utils/chunkedUpload';
import styles from './FileManagerPanel.module.css';

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

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const BookIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);

const KNOWN_FORMATS = new Set(['epub', 'mobi', 'pdf', 'cbz', 'cbr', 'azw3', 'fb2', 'djvu']);

function getFileFormat(name) {
  const ext = name.split('.').pop()?.toLowerCase();
  return ext && KNOWN_FORMATS.has(ext) ? ext : null;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} Go`;
}

function formatDate(d) {
  return d ? new Date(d).toLocaleString('fr-FR') : 'date inconnue';
}

const STATUS_LABELS = {
  pending: 'En attente',
  completed: 'Complétée',
  canceled: 'Annulée',
  reported: 'Signalée',
};

export default function FileManagerPanel() {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [renamingName, setRenamingName] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteModal, setDeleteModal] = useState(null); // { name, linkedRequests }
  const [busyName, setBusyName] = useState(null);
  const [search, setSearch] = useState('');
  const [linkedFilter, setLinkedFilter] = useState(''); // '' | 'linked' | 'unlinked'
  const [sortBy, setSortBy] = useState('date-desc'); // date-desc | date-asc | name-asc | name-desc | size-desc | size-asc
  const fileInputRef = useRef(null);

  const showAlertMsg = (type, message) => {
    setAlert({ type, message });
    setTimeout(() => setAlert(null), 6000);
  };

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axiosAdmin.get('/api/admin/files');
      setFiles(res.data.files || []);
    } catch {
      showAlertMsg('error', 'Impossible de charger la liste des fichiers.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      if (shouldChunk(file)) {
        // Gros fichier : upload en chunks pour contourner la limite de payload d'un
        // éventuel proxy devant l'instance (ex. Cloudflare) — le fichier assemblé
        // atterrit directement dans uploads/books, il suffit de rafraîchir la liste.
        await uploadFileChunked(file, { onProgress: setUploadProgress });
      } else {
        const formData = new FormData();
        formData.append('file', file);
        await axiosAdmin.post('/api/admin/files', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      showAlertMsg('success', 'Fichier envoyé avec succès.');
      await loadFiles();
    } catch (err) {
      showAlertMsg('error', err.response?.data?.error || 'Erreur lors de l\'envoi du fichier.');
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const startRename = (name) => {
    setRenamingName(name);
    setRenameValue(name.replace(/\.[^.]+$/, ''));
  };

  const cancelRename = () => {
    setRenamingName(null);
    setRenameValue('');
  };

  const confirmRename = async (name) => {
    if (!renameValue.trim()) return;
    setBusyName(name);
    try {
      const res = await axiosAdmin.patch('/api/admin/files/rename', { name, newName: renameValue.trim() });
      const count = res.data.updatedRequests || 0;
      showAlertMsg('success', count > 0 ? `Fichier renommé (${count} demande${count > 1 ? 's' : ''} mise${count > 1 ? 's' : ''} à jour).` : 'Fichier renommé.');
      cancelRename();
      await loadFiles();
    } catch (err) {
      showAlertMsg('error', err.response?.data?.error || 'Erreur lors du renommage.');
    } finally {
      setBusyName(null);
    }
  };

  const visibleFiles = useMemo(() => {
    let result = files;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(f => f.name.toLowerCase().includes(q));
    }
    if (linkedFilter === 'linked') result = result.filter(f => f.linkedRequests.length > 0);
    if (linkedFilter === 'unlinked') result = result.filter(f => f.linkedRequests.length === 0);

    const sorted = [...result];
    switch (sortBy) {
      case 'date-asc': sorted.sort((a, b) => new Date(a.modifiedAt) - new Date(b.modifiedAt)); break;
      case 'name-asc': sorted.sort((a, b) => a.name.localeCompare(b.name)); break;
      case 'name-desc': sorted.sort((a, b) => b.name.localeCompare(a.name)); break;
      case 'size-desc': sorted.sort((a, b) => b.size - a.size); break;
      case 'size-asc': sorted.sort((a, b) => a.size - b.size); break;
      case 'date-desc':
      default: sorted.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
    }
    return sorted;
  }, [files, search, linkedFilter, sortBy]);

  const requestDelete = (file) => {
    // Toujours une confirmation, avec ou sans demande liée (la liste vient déjà
    // de GET /api/admin/files, pas besoin d'un aller-retour supplémentaire).
    setDeleteModal({ name: file.name, linkedRequests: file.linkedRequests });
  };

  const confirmDelete = async () => {
    if (!deleteModal) return;
    const { name } = deleteModal;
    setBusyName(name);
    try {
      await axiosAdmin.delete('/api/admin/files', { data: { name, confirm: true } });
      showAlertMsg('success', 'Fichier supprimé.');
      setDeleteModal(null);
      await loadFiles();
    } catch (err) {
      showAlertMsg('error', err.response?.data?.error || 'Erreur lors de la suppression.');
    } finally {
      setBusyName(null);
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>
          <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          Fichiers
        </h2>
        <p className={styles.panelSubtitle}>
          Gère les fichiers ebook stockés sur le serveur (uploads/books). Renommer ou supprimer un fichier lié à une demande met à jour ou avertit avant toute perte de lien.
        </p>
      </div>

      <div className={styles.card}>
        <div className={styles.form}>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel}>Ajouter un fichier</label>
            <label className={styles.dropZone}>
              <input
                ref={fileInputRef}
                type="file"
                className={styles.fileInput}
                onChange={handleUpload}
                disabled={uploading}
              />
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={styles.dropZoneIcon}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              {uploading ? (
                <span className={styles.dropZoneText}>Envoi en cours{uploadProgress > 0 ? ` (${uploadProgress}%)` : '…'}</span>
              ) : (
                <>
                  <span className={styles.dropZoneText}>Glisser un fichier ici</span>
                  <span className={styles.dropZoneHint}>ou cliquer pour parcourir</span>
                </>
              )}
            </label>
            <p className={styles.fieldHint}>Le fichier est ajouté au dossier de stockage, sans être rattaché automatiquement à une demande.</p>
          </div>

          {alert && (
            <div className={`${styles.alert} ${alert.type === 'success' ? styles.alertSuccess : styles.alertError}`}>
              {alert.type === 'success' ? <CheckIcon /> : <AlertIcon />}
              {alert.message}
            </div>
          )}
        </div>
      </div>

      <div className={`${styles.card} ${styles.filesSection}`}>
        <p className={styles.filesSectionTitle}>
          Fichiers ({files.length}{files.length > 0 ? ` · ${formatSize(files.reduce((sum, f) => sum + f.size, 0))}` : ''})
        </p>

        {files.length > 0 && (
          <div className={styles.filterBar}>
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Rechercher un fichier..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <select className={styles.select} value={linkedFilter} onChange={e => setLinkedFilter(e.target.value)}>
              <option value="">Tous les fichiers</option>
              <option value="linked">Liés à une demande</option>
              <option value="unlinked">Non liés</option>
            </select>
            <select className={styles.select} value={sortBy} onChange={e => setSortBy(e.target.value)}>
              <option value="date-desc">Plus récent</option>
              <option value="date-asc">Plus ancien</option>
              <option value="name-asc">Nom (A → Z)</option>
              <option value="name-desc">Nom (Z → A)</option>
              <option value="size-desc">Taille (plus gros)</option>
              <option value="size-asc">Taille (plus léger)</option>
            </select>
          </div>
        )}

        {loading ? (
          <p className={styles.fieldHint}>Chargement…</p>
        ) : files.length === 0 ? (
          <p className={styles.fieldHint}>Aucun fichier dans le dossier de stockage.</p>
        ) : visibleFiles.length === 0 ? (
          <p className={styles.fieldHint}>Aucun fichier ne correspond à cette recherche/ce filtre.</p>
        ) : (
          <div className={styles.fileList}>
            {visibleFiles.map(f => (
              <div key={f.name} className={styles.fileRow}>
                {renamingName === f.name ? (
                  <div className={styles.renameForm}>
                    <input
                      className={styles.renameInput}
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      autoFocus
                      onKeyDown={e => {
                        if (e.key === 'Enter') confirmRename(f.name);
                        if (e.key === 'Escape') cancelRename();
                      }}
                    />
                    <button type="button" className={styles.btnTest} disabled={busyName === f.name} onClick={() => confirmRename(f.name)}>
                      {busyName === f.name ? '…' : 'Valider'}
                    </button>
                    <button type="button" className={styles.btnSecondary} onClick={cancelRename}>Annuler</button>
                  </div>
                ) : (
                  <div className={styles.fileRowMain}>
                    <div className={styles.fileFormatIcon}>
                      <BookIcon />
                      {getFileFormat(f.name) && <span className={styles.fileFormatLabel}>{getFileFormat(f.name)}</span>}
                    </div>
                    <div className={styles.fileRowInfo}>
                      <p className={styles.fileRowLabel}>
                        {f.name}
                        {f.linkedRequests.length > 0 && (
                          <span className={styles.linkedBadge}>{f.linkedRequests.length} demande{f.linkedRequests.length > 1 ? 's' : ''}</span>
                        )}
                      </p>
                      <p className={styles.fileRowMeta}>{formatSize(f.size)} · modifié le {formatDate(f.modifiedAt)}</p>
                    </div>
                  </div>
                )}

                {renamingName !== f.name && (
                  <div className={styles.fileRowActions}>
                    <button type="button" className={styles.btnTest} disabled={busyName === f.name} onClick={() => startRename(f.name)}>
                      Renommer
                    </button>
                    <button type="button" className={styles.btnDanger} disabled={busyName === f.name} onClick={() => requestDelete(f)}>
                      Supprimer
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {deleteModal && (
        <div className={styles.overlay} onClick={() => setDeleteModal(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>
                <AlertIcon />
                Confirmer la suppression
              </h3>
              <button type="button" className={styles.closeBtn} onClick={() => setDeleteModal(null)}>
                <CloseIcon />
              </button>
            </div>
            <div className={styles.modalBody}>
              {deleteModal.linkedRequests.length > 0 ? (
                <>
                  <p className={styles.modalText}>
                    Le fichier <strong>{deleteModal.name}</strong> est lié à {deleteModal.linkedRequests.length} demande{deleteModal.linkedRequests.length > 1 ? 's' : ''} :
                  </p>
                  <div className={styles.fileList}>
                    {deleteModal.linkedRequests.map(r => (
                      <div key={r._id} className={styles.fileRow}>
                        <div className={styles.fileRowInfo}>
                          <p className={styles.fileRowLabel}>{r.title}</p>
                          <p className={styles.fileRowMeta}>
                            {r.author ? `${r.author} · ` : ''}{r.username} · {STATUS_LABELS[r.status] || r.status}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className={styles.modalText}>
                    Supprimer ce fichier repassera {deleteModal.linkedRequests.length > 1 ? 'ces demandes' : 'cette demande'} en traitement manuel. Cette action est irréversible.
                  </p>
                </>
              ) : (
                <p className={styles.modalText}>
                  Le fichier <strong>{deleteModal.name}</strong> n'est lié à aucune demande. Cette action est irréversible.
                </p>
              )}
            </div>
            <div className={styles.modalFooter}>
              <button type="button" className={styles.btnSecondary} onClick={() => setDeleteModal(null)} disabled={busyName === deleteModal.name}>
                Annuler
              </button>
              <button type="button" className={styles.btnDanger} onClick={confirmDelete} disabled={busyName === deleteModal.name}>
                {busyName === deleteModal.name ? 'Suppression…' : 'Supprimer définitivement'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
