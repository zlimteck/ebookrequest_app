import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axiosAdmin from '../../axiosAdmin';
import { toast } from 'react-toastify';
import { useSocket } from '../../hooks/useSocket';
import 'react-toastify/dist/ReactToastify.css';
import styles from './UserDashboard.module.css';
import BookPreviewModal from '../../components/BookPreviewModal';
import BookReaderModal from '../../components/BookReaderModal';
import DownloadModal from '../../components/DownloadModal';
import CommentThread from '../../components/CommentThread';
import { compressImage, isImage } from '../../utils/imageCompressor';

function frToIso(str) {
  const s = (str || '').trim();
  if (/^\d{4}$/.test(s)) return s;
  if (/^\d{2}\/\d{4}$/.test(s)) { const [m, y] = s.split('/'); return `${y}-${m}`; }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) { const [d, m, y] = s.split('/'); return `${y}-${m}-${d}`; }
  return s;
}
function isoToFr(str) {
  if (!str) return '';
  const parts = str.split('-');
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[1]}/${parts[0]}`;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

const READABLE_EXTS = ['pdf', 'epub', 'cbz', 'cbr'];
const isReadable = (filePath) => {
  if (!filePath) return false;
  const ext = filePath.split(/[\\/]/).pop().split('.').pop().toLowerCase();
  return READABLE_EXTS.includes(ext);
};


const UserDashboard = () => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const filterBarRef = useRef(null);
  const filterScrollRestore = useRef(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const highlightId  = searchParams.get('highlight');
  const cardRefs     = useRef({});
  const [downloadingFile, setDownloadingFile] = useState(null);
  const [reportModal, setReportModal] = useState({ isOpen: false, requestId: null, requestTitle: '' });
  const [readerRequest, setReaderRequest] = useState(null);
  const [downloadModalRequest, setDownloadModalRequest] = useState(null);
  const [reportReason, setReportReason] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 6;
  const [previewBook, setPreviewBook] = useState(null);
  const [search, setSearch] = useState('');
  const [commentModal, setCommentModal] = useState(null); // request._id pour le modal note
  const [commentValue, setCommentValue] = useState('');
  const [threadModal, setThreadModal] = useState(null); // request object pour le fil
  const [expandedHistory, setExpandedHistory] = useState(null);
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('ebookrequest_view_user') || 'cards');
  const [expandedTableRows, setExpandedTableRows] = useState(new Set());
  const [sortConfig, setSortConfig] = useState({ key: null, dir: 'asc' });
  const [deleteModal, setDeleteModal] = useState(null); // request object
  const [editModal, setEditModal]   = useState(null); // request object
  const [editForm, setEditForm]     = useState({ title: '', author: '', format: '', link: '', publishedDate: '', thumbnail: '' });
  const [editSaving, setEditSaving] = useState(false);
  const [calibreEnabled, setCalibreEnabled] = useState(false);
  const [calibreShelves, setCalibreShelves] = useState([]); // [{ name, isDefault }]
  const [shelfModalRequest, setShelfModalRequest] = useState(null); // request object
  const [shelfModalSelection, setShelfModalSelection] = useState([]);
  const [shelfModalSaving, setShelfModalSaving] = useState(false);
  const [shelfModalChecking, setShelfModalChecking] = useState(false);
  const [shelfModalError, setShelfModalError] = useState('');
  // Multishelf multi-utilisateurs (admin) — comptes Calibre-Web ciblables en
  // plus du propriétaire de la demande, directement depuis "Mes demandes".
  const isAdmin = localStorage.getItem('role') === 'admin';
  const [shelfTargetUsers, setShelfTargetUsers] = useState([]); // [{ _id, username, shelves: [{name,isDefault}] }]
  const [extraShelfSelections, setExtraShelfSelections] = useState({}); // { [userId]: [shelfName, ...] }

  const deleteModalRef  = useFocusTrap(!!deleteModal);
  const editModalRef    = useFocusTrap(!!editModal);
  const commentModalRef = useFocusTrap(!!commentModal);
  const reportModalRef  = useFocusTrap(reportModal.isOpen);
  const shelfModalRef   = useFocusTrap(!!shelfModalRequest);

  const setView = (mode) => {
    setViewMode(mode);
    localStorage.setItem('ebookrequest_view_user', mode);
  };

  const toggleSort = (key) => {
    setSortConfig(prev => prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'asc' }
    );
  };

  const SortIcon = ({ colKey }) => {
    if (sortConfig.key !== colKey) return (
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.3, marginLeft: '0.25rem', flexShrink: 0 }}>
        <line x1="12" y1="5" x2="12" y2="19"/><polyline points="5 12 12 5 19 12"/>
      </svg>
    );
    return sortConfig.dir === 'asc' ? (
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginLeft: '0.25rem', flexShrink: 0 }}>
        <line x1="12" y1="5" x2="12" y2="19"/><polyline points="5 12 12 5 19 12"/>
      </svg>
    ) : (
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginLeft: '0.25rem', flexShrink: 0 }}>
        <line x1="12" y1="5" x2="12" y2="19"/><polyline points="5 19 12 12 19 19"/>
      </svg>
    );
  };

  const toggleTableRow = (id) => {
    setExpandedTableRows(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const getFileType = (filename) => {
    if (!filename) return '';
    const ext = filename.split('.').pop().toLowerCase();
    return ext.toUpperCase();
  };

  // Récupère les demandes de l'utilisateur connecté
  const fetchRequests = async () => {
    try {
      setLoading(true);
      const response = await axiosAdmin.get(`/api/requests/my-requests?status=${filter === 'all' ? '' : filter}`);
      
      // Tri des demandes pour afficher : Signalées, Terminées, En attente, puis Annulées
      const sortedRequests = [...response.data].sort((a, b) => {
        const statusPriority = {
          'reported': 1,
          'completed': 2,
          'pending': 3,
          'canceled': 4
        };
        
        const aPriority = statusPriority[a.status] || 3;
        const bPriority = statusPriority[b.status] || 3;
        
        if (aPriority < bPriority) return -1;
        if (aPriority > bPriority) return 1;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
      setRequests(sortedRequests);
    } catch (error) {
      console.error('Erreur lors de la récupération des demandes:', error);
      toast.error('Erreur lors du chargement de vos demandes');
    } finally {
      setLoading(false);
    }
  };

  // Config Calibre-Web (juste pour savoir si le bouton "Étagères" doit
  // apparaître, et avec quelles étagères/défauts le pré-remplir).
  const fetchCalibreConfig = async () => {
    try {
      const res = await axiosAdmin.get('/api/users/calibre');
      const enabled = res.data?.enabled && Array.isArray(res.data.shelves) && res.data.shelves.length > 0;
      setCalibreEnabled(enabled);
      setCalibreShelves(res.data?.shelves || []);
    } catch {
      setCalibreEnabled(false);
    }
  };

  // Comptes Calibre-Web ciblables pour le multishelf multi-utilisateurs
  // (admin uniquement) — permet de pousser aussi vers l'étagère d'un autre
  // utilisateur directement depuis "Mes demandes", sans passer par l'admin.
  const fetchShelfTargets = async () => {
    try {
      const res = await axiosAdmin.get('/api/requests/calibre/shelf-targets');
      setShelfTargetUsers(Array.isArray(res.data) ? res.data : []);
    } catch {
      setShelfTargetUsers([]);
    }
  };

  const toggleExtraShelf = (userId, shelfName) => {
    setExtraShelfSelections(prev => {
      const current = prev[userId] || [];
      const next = current.includes(shelfName)
        ? current.filter(s => s !== shelfName)
        : [...current, shelfName];
      const updated = { ...prev };
      if (next.length) updated[userId] = next; else delete updated[userId];
      return updated;
    });
  };

  const openShelfModal = async (request) => {
    setShelfModalRequest(request);
    setShelfModalError('');
    const defaults = calibreShelves.filter(s => s.isDefault).map(s => s.name);
    const cached = request.selectedShelves !== undefined && request.selectedShelves.length
      ? request.selectedShelves
      : defaults;

    // Pré-remplissage optimiste avec le cache le temps de la vérification en direct,
    // pour ne pas laisser la modale vide pendant l'appel réseau.
    setShelfModalSelection(cached);

    // Pré-remplissage des cibles additionnelles déjà connues sur la demande.
    const previousExtra = {};
    (request.extraShelfTargets || []).forEach(t => {
      const uid = typeof t.user === 'string' ? t.user : t.user?._id || t.user;
      if (uid) previousExtra[uid] = t.shelves || [];
    });
    setExtraShelfSelections(previousExtra);

    setShelfModalChecking(true);
    try {
      const res = await axiosAdmin.get(`/api/users/calibre/requests/${request._id}/shelves`);
      // shelves === null : vérification impossible côté serveur (ou livre pas encore
      // dans Calibre) — on garde le cache plutôt que d'afficher "aucune étagère" à tort.
      if (Array.isArray(res.data?.shelves)) {
        setShelfModalSelection(res.data.shelves);
      }
    } catch {
      // Silencieux — on reste sur le cache, l'utilisateur peut quand même envoyer.
    } finally {
      setShelfModalChecking(false);
    }
  };

  const toggleShelfModalSelection = (name) => {
    setShelfModalSelection(prev => prev.includes(name) ? prev.filter(s => s !== name) : [...prev, name]);
  };

  const handleSaveShelves = async () => {
    if (!shelfModalRequest) return;
    setShelfModalSaving(true);
    setShelfModalError('');
    try {
      const res = await axiosAdmin.post(`/api/users/calibre/requests/${shelfModalRequest._id}/shelves`, {
        shelves: shelfModalSelection,
      });

      // Cibles additionnelles (admin) — on envoie une cible même à shelves
      // vides si elle avait une sélection précédente, pour permettre le retrait.
      let extraResults = null;
      if (isAdmin) {
        const extraTargets = shelfTargetUsers
          .map(u => ({ userId: u._id, shelves: extraShelfSelections[u._id] || [] }))
          .filter(t => t.shelves.length > 0 || (shelfModalRequest.extraShelfTargets || []).some(e => {
            const uid = typeof e.user === 'string' ? e.user : e.user?._id || e.user;
            return uid === t.userId;
          }));
        if (extraTargets.length) {
          try {
            const extraRes = await axiosAdmin.post(`/api/requests/${shelfModalRequest._id}/extra-shelves`, { targets: extraTargets });
            extraResults = extraRes.data?.results || [];
          } catch (err) {
            toast.warning(err.response?.data?.error || 'Erreur lors de l\'envoi vers les étagères additionnelles');
          }
        }
      }

      setRequests(prev => prev.map(r => r._id === shelfModalRequest._id
        ? {
            ...r,
            selectedShelves: shelfModalSelection,
            calibrePush: { ...r.calibrePush, status: res.data.failed?.length ? 'partial' : 'success', calibreBookId: res.data.calibreBookId },
            ...(extraResults && {
              extraShelfTargets: extraResults.map(er => ({ user: er.userId, username: er.username, shelves: extraShelfSelections[er.userId] || [], status: er.status, error: er.error || null })),
            }),
          }
        : r));
      if (res.data.failed?.length) {
        toast.warning(`Échec sur : ${res.data.failed.map(f => `${f.name} (${f.action === 'remove' ? 'retrait' : 'ajout'})`).join(', ')}`);
      } else {
        const parts = [];
        if (res.data.succeeded?.length) parts.push(`ajouté à ${res.data.succeeded.join(', ')}`);
        if (res.data.removed?.length) parts.push(`retiré de ${res.data.removed.join(', ')}`);
        toast.success(parts.length ? `Livre ${parts.join(' — ')}` : 'Sélection d\'étagères inchangée');
      }
      if (extraResults?.some(r => r.status === 'failed' || r.status === 'partial')) {
        const failedNames = extraResults.filter(r => r.status !== 'success').map(r => r.username).join(', ');
        toast.warning(`Étagères additionnelles — problème pour : ${failedNames}`);
      }
      setShelfModalRequest(null);
    } catch (err) {
      setShelfModalError(err.response?.data?.error || 'Erreur lors de l\'envoi vers les étagères');
    } finally {
      setShelfModalSaving(false);
    }
  };
  
  // Marquer une demande comme téléchargée
  const markAsDownloaded = async (requestId) => {
    try {
      const response = await axiosAdmin.put(`/api/requests/${requestId}/mark-downloaded`);
      if (response.data.success) {
        setRequests(prevRequests =>
          prevRequests.map(req =>
            req._id === requestId
              ? { ...req, downloadedAt: response.data.downloadedAt }
              : req
          )
        );
        return true;
      }
    } catch (error) {
      console.error('Erreur lors du marquage comme téléchargé:', error);
      toast.error('Erreur lors de l\'enregistrement du téléchargement');
    }
    return false;
  };

  // Signaler un problème
  const handleReportRequest = async () => {
    if (!reportReason.trim()) {
      toast.error('Veuillez indiquer la raison du signalement');
      return;
    }

    try {
      const response = await axiosAdmin.post(`/api/requests/${reportModal.requestId}/report`, {
        reason: reportReason
      });

      if (response.data.success) {
        toast.success('Signalement envoyé avec succès. Un administrateur va examiner le problème.');
        setReportModal({ isOpen: false, requestId: null, requestTitle: '' });
        setReportReason('');
        // Rafraîchir les demandes
        await fetchRequests();
      }
    } catch (error) {
      console.error('Erreur lors du signalement:', error);
      toast.error(error.response?.data?.error || 'Erreur lors du signalement');
    }
  };

  // Supprimer une demande
  const handleDeleteRequest = async () => {
    if (!deleteModal) return;
    try {
      await axiosAdmin.delete(`/api/requests/${deleteModal._id}`);
      setRequests(prev => prev.filter(r => r._id !== deleteModal._id));
      toast.success('Demande supprimée.');
      setDeleteModal(null);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la suppression.');
    }
  };

  // Ouvrir le modal d'édition
  const openEditModal = (request) => {
    setEditForm({
      title:         request.title         || '',
      author:        request.author        || '',
      format:        request.format        || '',
      link:          request.link          || '',
      publishedDate: isoToFr(request.publishedDate || ''),
      thumbnail:     request.thumbnail     || '',
    });
    setEditModal(request);
  };

  const handleEditCoverChange = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const process = (f) => {
      const reader = new FileReader();
      reader.onloadend = () => setEditForm(prev => ({ ...prev, thumbnail: reader.result }));
      reader.readAsDataURL(f);
    };
    if (isImage(file) && file.size > 1 * 1024 * 1024) {
      try {
        const compressed = await compressImage(file, { maxSizeMB: 1, maxWidthOrHeight: 1200 });
        process(compressed);
      } catch {
        process(file);
      }
    } else {
      process(file);
    }
  }, []);

  // Sauvegarder les modifications d'une demande
  const handleEditRequest = async () => {
    if (!editModal) return;
    if (!editForm.title.trim() || !editForm.author.trim()) {
      toast.error('Le titre et l\'auteur sont obligatoires.');
      return;
    }
    if (editForm.publishedDate && !/^(\d{2}\/\d{2}\/\d{4}|\d{2}\/\d{4}|\d{4})$/.test(editForm.publishedDate.trim())) {
      toast.error('Format de date invalide. Utilisez : 2024, 06/2024 ou 15/06/2024.');
      return;
    }
    setEditSaving(true);
    try {
      const payload = { ...editForm, publishedDate: frToIso(editForm.publishedDate) };
      const { data } = await axiosAdmin.patch(`/api/requests/${editModal._id}/user-edit`, payload);
      setRequests(prev => prev.map(r => r._id === editModal._id ? { ...r, ...data.request } : r));
      toast.success('Demande mise à jour.');
      setEditModal(null);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la modification.');
    } finally {
      setEditSaving(false);
    }
  };

  // Sauvegarder un commentaire utilisateur
  const saveUserComment = async (requestId) => {
    try {
      await axiosAdmin.patch(`/api/requests/${requestId}/user-comment`, { comment: commentValue });
      setRequests(prev => prev.map(r => r._id === requestId ? { ...r, userComment: commentValue } : r));
      setCommentModal(null);
      setCommentValue('');
    } catch {
      toast.error('Erreur lors de la sauvegarde du commentaire');
    }
  };

  // Télécharger un fichier ou ouvrir un lien
  const downloadFile = async (request) => {
    if (downloadingFile === request._id) return;
    
    setDownloadingFile(request._id);

    try {
      // Marquer la demande comme téléchargée
      const marked = await markAsDownloaded(request._id);
      if (!marked) return;

      // Si c'est un lien de téléchargement externe
      if (request.downloadLink) {
        // Ouvrir le lien dans un nouvel onglet
        window.open(request.downloadLink, '_blank', 'noopener,noreferrer');
        return;
      }

      // Si c'est un fichier à télécharger via l'API
      if (request.filePath) {
        const response = await axiosAdmin.get(
          `/api/requests/download/${request._id}`,
          { responseType: 'blob' }
        );

        const url = window.URL.createObjectURL(new Blob([response.data]));
        const link = document.createElement('a');
        link.href = url;
        
        // Extraire le nom du fichier depuis le header Content-Disposition
        const contentDisposition = response.headers['content-disposition'] || '';
        let fileName = '';
        
        // Essayer d'extraire le nom du fichier depuis le Content-Disposition
        const fileNameMatch = contentDisposition.match(/filename\*?=['"](?:UTF-8'')?([^;\n"]*)['"]?;?/i) || 
                           contentDisposition.match(/filename=['"]([^;\n"]*)['"]?;?/i);
        
        if (fileNameMatch && fileNameMatch[1]) {
          fileName = fileNameMatch[1].trim();
          // Nettoyer le nom de fichier si nécessaire
          fileName = fileName.replace(/[^\w\d\.\-]/g, '_');
        } else {
          // Utiliser un nom de fichier par défaut si non trouvé dans le header
          fileName = `ebook_${request._id}.${request.filePath ? request.filePath.split('.').pop() : 'pdf'}`;
        }
        
        link.setAttribute('download', fileName);
        document.body.appendChild(link);
        link.click();
        
        // Nettoyage
        link.remove();
        window.URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Erreur lors du téléchargement du fichier:', error);
      toast.error('Erreur lors du téléchargement du fichier');
    } finally {
      setDownloadingFile(null);
    }
  };
  

  // Refresh silencieux toutes les 30s (sans spinner, notifie si statut changé)
  const silentRefresh = async () => {
    try {
      const response = await axiosAdmin.get(`/api/requests/my-requests?status=${filter === 'all' ? '' : filter}`);
      const STATUS_ORDER = { reported: 1, completed: 2, pending: 3, canceled: 4 };
      const sorted = [...response.data].sort((a, b) => {
        const diff = (STATUS_ORDER[a.status] || 3) - (STATUS_ORDER[b.status] || 3);
        return diff !== 0 ? diff : new Date(b.createdAt) - new Date(a.createdAt);
      });

      setRequests(prev => {
        // Détecte les changements de statut ou nouveaux fichiers
        const changed = sorted.filter(newR => {
          const old = prev.find(r => r._id === newR._id);
          return old && (old.status !== newR.status || old.filePath !== newR.filePath || old.downloadLink !== newR.downloadLink);
        });
        const added = sorted.filter(newR => !prev.find(r => r._id === newR._id));

        if (changed.length > 0 || added.length > 0) {
          changed.forEach(r => {
            if (r.status === 'completed' && prev.find(p => p._id === r._id)?.status !== 'completed') {
              toast.success(`📖 "${r.title}" est maintenant disponible !`, { autoClose: 6000 });
            } else if (r.status === 'canceled' && prev.find(p => p._id === r._id)?.status !== 'canceled') {
              toast.info(`"${r.title}" a été annulée.`);
            }
          });
          return sorted;
        }
        return prev; // pas de changement → pas de re-render
      });
    } catch {}
  };

  useEffect(() => {
    const intervalId = setInterval(silentRefresh, 30000);
    return () => clearInterval(intervalId);
  }, [filter]); // eslint-disable-line

  useSocket('request:updated', () => silentRefresh());

  useEffect(() => {
    fetchCalibreConfig();
    if (isAdmin) fetchShelfTargets();
  }, []);

  useEffect(() => {
    setCurrentPage(1);
    fetchRequests();
  }, [filter]);

  useEffect(() => {
    if (filterScrollRestore.current !== null && filterBarRef.current) {
      filterBarRef.current.scrollLeft = filterScrollRestore.current;
      filterScrollRestore.current = null;
    }
  }, [filter, currentPage]);

  // ── Scroll vers la demande mise en surbrillance ─────────────────────────
  useEffect(() => {
    if (!highlightId || !requests.length) return;
    const idx = requests.findIndex(r => r._id === highlightId);
    if (idx === -1) return;
    // S'assurer que le filtre est sur "all" pour que la demande soit visible
    setFilter('all');
    const targetPage = Math.floor(idx / ITEMS_PER_PAGE) + 1;
    setCurrentPage(targetPage);
  }, [highlightId, requests]); // eslint-disable-line

  useEffect(() => {
    if (!highlightId) return;
    const el = cardRefs.current[highlightId];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightId, currentPage]);

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.loadingSpinner}></div>
        <p>Chargement de vos demandes...</p>
      </div>
    );
  }

  const filteredRequests = (() => {
    const STATUS_ORDER = { reported: 1, completed: 2, pending: 3, canceled: 4 };
    const base = requests.filter(r => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return r.title?.toLowerCase().includes(q) || r.author?.toLowerCase().includes(q);
    });
    if (!sortConfig.key) return base;
    return [...base].sort((a, b) => {
      let va, vb;
      if (sortConfig.key === 'status') { va = STATUS_ORDER[a.status] ?? 9; vb = STATUS_ORDER[b.status] ?? 9; }
      else if (sortConfig.key === 'createdAt') { va = new Date(a.createdAt); vb = new Date(b.createdAt); }
      else { va = (a[sortConfig.key] || '').toLowerCase(); vb = (b[sortConfig.key] || '').toLowerCase(); }
      if (va < vb) return sortConfig.dir === 'asc' ? -1 : 1;
      if (va > vb) return sortConfig.dir === 'asc' ? 1 : -1;
      return 0;
    });
  })();

  // Cibles additionnelles disponibles pour le multishelf multi-utilisateurs
  // (admin uniquement) — tous les comptes Calibre-Web activés sauf soi-même
  // (propriétaire de toutes les demandes listées ici).
  const extraTargetCandidates = isAdmin
    ? shelfTargetUsers.filter(u => u.username !== localStorage.getItem('username'))
    : [];

  return (
    <div className={styles.dashboardContainer}>
      {previewBook && <BookPreviewModal book={previewBook} onClose={() => setPreviewBook(null)} />}

      {threadModal && (
        <CommentThread
          request={threadModal}
          currentRole="user"
          onClose={() => setThreadModal(null)}
          onUpdate={(id, comments) => {
            setRequests(prev => prev.map(r => r._id === id ? { ...r, comments } : r));
            setThreadModal(prev => prev?._id === id ? { ...prev, comments } : prev);
          }}
        />
      )}

      {/* Modal note utilisateur */}
      {commentModal && (() => {
        const req = requests.find(r => r._id === commentModal);
        return (
          <div className={styles.noteModalOverlay} onClick={(e) => {
            if (e.target === e.currentTarget) { setCommentModal(null); setCommentValue(''); }
          }}>
            <div className={styles.noteModal} ref={commentModalRef} role="dialog" aria-modal="true" aria-label="Note personnelle">
              <div className={styles.noteModalHeader}>
                <div>
                  <h3 className={styles.noteModalTitle}>{req?.userComment ? 'Modifier ma note' : 'Ajouter une note'}</h3>
                  {req && <p className={styles.noteModalBook}>{req.title}</p>}
                </div>
                <button className={styles.noteModalClose} onClick={() => { setCommentModal(null); setCommentValue(''); }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
              <div className={styles.noteModalBody}>
                <textarea
                  className={styles.noteModalTextarea}
                  value={commentValue}
                  onChange={e => setCommentValue(e.target.value)}
                  placeholder="Ajouter une note personnelle…"
                  maxLength={500}
                  rows={5}
                  autoFocus
                />
                <span className={styles.noteModalCount}>{commentValue.length}/500</span>
              </div>
              <div className={styles.noteModalFooter}>
                <button className={styles.noteModalCancel} onClick={() => { setCommentModal(null); setCommentValue(''); }}>
                  Annuler
                </button>
                <button className={styles.noteModalSave} onClick={() => saveUserComment(commentModal)}>
                  Enregistrer
                </button>
              </div>
            </div>
          </div>
        );
      })()}
      <h1>Mes demandes</h1>

      <div className={styles.searchBar}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input
          type="text"
          aria-label="Rechercher par titre ou auteur"
          placeholder="Rechercher par titre ou auteur…"
          value={search}
          onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
          className={styles.searchInput}
        />
        {search && (
          <button className={styles.searchClear} onClick={() => { setSearch(''); setCurrentPage(1); }}>×</button>
        )}
        <div className={styles.viewToggle}>
          <button
            className={`${styles.viewBtn} ${viewMode === 'cards' ? styles.viewBtnActive : ''}`}
            onClick={() => setView('cards')}
            title="Vue grille"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
              <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
            </svg>
          </button>
          <button
            className={`${styles.viewBtn} ${viewMode === 'table' ? styles.viewBtnActive : ''}`}
            onClick={() => setView('table')}
            title="Vue tableau"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

      <div className={styles.filterBarWrapper}>
        <div className={styles.filterBar} ref={filterBarRef}>
          {[
            { key: 'all',       label: 'Toutes',      color: null },
            { key: 'pending',   label: 'En attente',  color: '#f59e0b' },
            { key: 'completed', label: 'Terminées',   color: '#10b981' },
            { key: 'reported',  label: 'Signalées',   color: '#8b5cf6' },
            { key: 'canceled',  label: 'Annulées',    color: '#ef4444' },
          ].map(({ key, label, color }) => {
            const count = key === 'all'
              ? requests.length
              : requests.filter(r => r.status === key).length;
            const isActive = filter === key;
            return (
              <button
                key={key}
                className={`${styles.filterPill} ${isActive ? styles.filterPillActive : ''}`}
                style={isActive && color ? { background: color + '1a', color } : {}}
                onClick={() => {
                  filterScrollRestore.current = filterBarRef.current?.scrollLeft ?? 0;
                  setFilter(key);
                  setCurrentPage(1);
                }}
              >
                {color && <span className={styles.filterDot} style={{ background: color }}/>}
                {label}
                {count > 0 && <span className={styles.filterCount}>{count}</span>}
              </button>
            );
          })}
        </div>
      </div>

      {filteredRequests.length === 0 ? (
        <div className={styles.emptyState}>
          <p>{search ? `Aucun résultat pour "${search}"` : `Vous n'avez aucune demande${filter !== 'all' ? ` (${filter})` : ''}.`}</p>
        </div>
      ) : (
        <>
        {viewMode === 'table' && (
          <div className={styles.tableWrapper}>
            <table className={styles.requestsTable}>
              <thead className={styles.tableHead}>
                <tr>
                  {[
                    { label: 'Titre / Auteur', key: 'title' },
                    { label: 'Format',         key: 'format' },
                    { label: 'Statut',         key: 'status' },
                    { label: 'Date',           key: 'createdAt' },
                  ].map(({ label, key }) => (
                    <th key={key} className={`${styles.tableTh} ${styles.tableThSortable}`} onClick={() => toggleSort(key)}>
                      {label}<SortIcon colKey={key} />
                    </th>
                  ))}
                  <th className={styles.tableTh} style={{ width: '1%', whiteSpace: 'nowrap' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRequests.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE).map((request) => {
                  const isRowExpanded = expandedTableRows.has(request._id);
                  return (
                    <React.Fragment key={request._id}>
                      <tr
                        ref={el => { cardRefs.current[request._id] = el; }}
                        className={`${styles.tableRow} ${isRowExpanded ? styles.tableRowExpanded : ''} ${highlightId === request._id ? styles.cardHighlight : ''}`}
                        onClick={() => toggleTableRow(request._id)}
                      >
                        <td className={styles.tableTd}>
                          <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{request.title}</div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>{request.author}</div>
                        </td>
                        <td className={styles.tableTd}>
                          {request.format ? <span className={styles.formatBadge}>{request.format.toUpperCase()}</span> : '—'}
                        </td>
                        <td className={styles.tableTd}>
                          <span className={`${styles.tableStatusBadge} ${
                            request.status === 'completed' ? styles.completedBadge :
                            request.status === 'canceled' ? styles.canceledBadge :
                            request.status === 'reported' ? styles.reportedBadge :
                            styles.pendingBadge
                          }`}>
                            {request.status === 'completed' ? 'Terminée' :
                             request.status === 'canceled' ? 'Annulée' :
                             request.status === 'reported' ? 'Signalée' : 'En attente'}
                          </span>
                        </td>
                        <td className={styles.tableTd} style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                          {new Date(request.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                        </td>
                        <td className={styles.tableTd} onClick={e => e.stopPropagation()}>
                          <div className={styles.actionIcons}>
                            {(request.thumbnail || request.description) && (
                              <button className={styles.iconBtn} onClick={() => setPreviewBook(request)} title="Aperçu du livre">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                                </svg>
                              </button>
                            )}
                            {request.link && (
                              <a href={request.link} className={styles.iconBtn} target="_blank" rel="noopener noreferrer" title="Voir plus d'informations">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                                  <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                                </svg>
                              </a>
                            )}
                            {request.status === 'completed' && (request.downloadLink || request.filePath) && (
                              <>
                                {isReadable(request.filePath) && (
                                  <button
                                    className={`${styles.iconBtn} ${styles.iconBtnSuccess}`}
                                    onClick={() => setReaderRequest({ title: request.title, requestId: { _id: request._id, filePath: request.filePath, downloadLink: request.downloadLink } })}
                                    title="Lire"
                                  >
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
                                    </svg>
                                  </button>
                                )}
                                <button
                                  className={`${styles.iconBtn} ${styles.iconBtnPrimary}`}
                                  onClick={() => setDownloadModalRequest(request)}
                                  title="Télécharger"
                                >
                                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                    <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                                  </svg>
                                </button>
                                {(calibreEnabled || extraTargetCandidates.length > 0) && (
                                  <button className={styles.iconBtn} onClick={() => openShelfModal(request)} title="Envoyer vers des étagères Calibre-Web">
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M3 3v18h18"/><path d="M3 8h18"/><path d="M3 13h18"/><path d="M3 18h18"/>
                                    </svg>
                                  </button>
                                )}
                                <button className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={() => setReportModal({ isOpen: true, requestId: request._id, requestTitle: request.title })} title="Signaler un problème">
                                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
                                    <line x1="4" y1="22" x2="4" y2="15"/>
                                  </svg>
                                </button>
                              </>
                            )}
                            <button className={`${styles.iconBtn} ${styles.iconBtnNote}`} onClick={() => setThreadModal(request)} title="Messages" style={{ position: 'relative' }}>
                              {request.comments?.some(c => c.role === 'admin' && !c.seenByUser) && (
                                <span style={{ position: 'absolute', top: 2, right: 2, width: 6, height: 6, borderRadius: '50%', background: '#ef4444' }} />
                              )}
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                              </svg>
                            </button>
                            <button className={`${styles.iconBtn} ${styles.iconBtnNote}`} onClick={() => { setCommentModal(request._id); setCommentValue(request.userComment || ''); }} title={request.userComment ? 'Modifier la note' : 'Ajouter une note'}>
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                {request.userComment ? (
                                  <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>
                                ) : (
                                  <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>
                                )}
                              </svg>
                            </button>
                            {request.status === 'pending' && (
                              <button className={`${styles.iconBtn} ${styles.iconBtnEdit}`} onClick={() => openEditModal(request)} title="Modifier la demande">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                </svg>
                              </button>
                            )}
                            {['pending', 'canceled'].includes(request.status) && (
                              <button className={`${styles.iconBtn} ${styles.iconBtnDelete}`} onClick={() => setDeleteModal(request)} title="Supprimer la demande">
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="3 6 5 6 21 6"/>
                                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                                  <path d="M10 11v6"/><path d="M14 11v6"/>
                                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                                </svg>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isRowExpanded && (
                        <tr className={styles.tableExpandRow}>
                          <td className={styles.tableExpandCell} colSpan={5}>
                            <div className={styles.tableExpandPanel}>
                              {request.adminComment && (
                                <div className={styles.adminComment}>
                                  <span className={styles.adminCommentLabel}>Note admin</span>
                                  <p>{request.adminComment}</p>
                                </div>
                              )}
                              {request.userComment && (
                                <div className={styles.userCommentDisplay}>
                                  <span className={styles.userCommentLabel}>Ma note</span>
                                  <p>{request.userComment}</p>
                                </div>
                              )}
                              {request.status === 'canceled' && request.cancelReason && (
                                <div className={styles.cancelReason}>
                                  <span className={styles.cancelReasonLabel}>Motif :</span> {request.cancelReason}
                                </div>
                              )}
                              {request.status === 'reported' && request.reportReason && (
                                <div className={styles.reportedNotice}>
                                  <span className={styles.reportedLabel}>Problème signalé</span>
                                  <p>{request.reportReason}</p>
                                </div>
                              )}
                              {request.status === 'pending' && request.autoDownloadFailed?.at && (
                                <div className={styles.manualNotice}>
                                  <span className={styles.manualNoticeLabel}>Traitement manuel</span>
                                  <p>
                                    {request.autoDownloadFailed.reason || 'Le téléchargement automatique n\'a pas abouti.'}
                                    {' '}Un administrateur va s’en occuper manuellement : comptez un délai supplémentaire.
                                  </p>
                                </div>
                              )}
                              {request.statusHistory?.length > 1 && (
                                <div className={styles.historyBlock}>
                                  <button className={styles.historyToggle} onClick={() => setExpandedHistory(expandedHistory === request._id ? null : request._id)}>
                                    Historique {expandedHistory === request._id ? '▲' : '▼'}
                                  </button>
                                  {expandedHistory === request._id && (
                                    <div className={styles.historyList}>
                                      {[...request.statusHistory].reverse().map((h, i) => (
                                        <div key={i} className={styles.historyItem}>
                                          <span className={styles.historyStatus}>{
                                            h.status === 'pending' ? '⏳ En attente' :
                                            h.status === 'completed' ? '✅ Complétée' :
                                            h.status === 'canceled' ? '❌ Annulée' :
                                            h.status === 'reported' ? '⚠️ Signalée' : h.status
                                          }</span>
                                          <span className={styles.historyDate}>
                                            {new Date(h.changedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })} {new Date(h.changedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                                            {h.changedBy && <em> · {h.changedBy}</em>}
                                          </span>
                                          {h.note && <span className={styles.historyNote}>{h.note.replace(/\s*via\s+\S+/gi, '')}</span>}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {viewMode === 'cards' && (
        <div className={styles.requestsGrid}>
          {filteredRequests.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE).map((request) => (
            <div key={request._id}
              ref={el => { cardRefs.current[request._id] = el; }}
              className={`${styles.requestCard} ${highlightId === request._id ? styles.cardHighlight : ''} ${
              request.status === 'completed' ? styles.cardCompleted :
              request.status === 'canceled' ? styles.cardCanceled :
              request.status === 'reported' ? styles.cardReported :
              styles.cardPending
            }`}>
              {/* Cover sidebar */}
              <div className={styles.bookCover} onClick={() => setPreviewBook(request)}>
                {request.thumbnail ? (
                  <img
                    src={request.thumbnail}
                    alt={`Couverture de ${request.title}`}
                    className={styles.coverImage}
                    onError={(e) => {
                      e.target.style.display = 'none';
                      e.target.nextElementSibling.style.display = 'flex';
                    }}
                  />
                ) : null}
                <div className={styles.noCoverPlaceholder} style={{ display: request.thumbnail ? 'none' : 'flex' }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                  </svg>
                </div>
              </div>

              {/* Content */}
              <div className={styles.requestContent}>
                {/* Header */}
                <div className={styles.requestHeader}>
                  <h3 className={styles.requestTitle}>{request.title}</h3>
                  <span className={`${styles.statusBadge} ${
                    request.status === 'completed' ? styles.completedBadge :
                    request.status === 'canceled' ? styles.canceledBadge :
                    request.status === 'reported' ? styles.reportedBadge :
                    styles.pendingBadge
                  }`}>
                    {request.status === 'completed' ? 'Terminée' :
                     request.status === 'canceled' ? 'Annulée' :
                     request.status === 'reported' ? 'Signalée' : 'En attente'}
                  </span>
                  {request.status === 'pending' && request.autoDownloadFailed?.at && (
                    <span className={styles.manualBadge}>
                      Traitement manuel
                    </span>
                  )}
                </div>

                <p className={styles.requestAuthor}>
                  {request.author}
                </p>

                {/* Meta: format + pages + année + série */}
                {(request.format || request.pageCount > 0 || request.publishedDate || request.seriesName) && (
                  <div className={styles.metaRow}>
                    {request.format && (
                      <span className={styles.formatBadge}>{request.format.toUpperCase()}</span>
                    )}
                    {request.pageCount > 0 && (
                      <span className={styles.pagesBadge}>{request.pageCount} pages</span>
                    )}
                    {request.publishedDate && (
                      <span className={styles.pagesBadge}>{isoToFr(request.publishedDate)}</span>
                    )}
                    {request.seriesName && (
                      <span className={styles.seriesBadge}>
                        {request.seriesName}{request.seriesIndex ? ` — Tome ${request.seriesIndex}` : ''}
                      </span>
                    )}
                  </div>
                )}

                {/* Description */}
                {request.description && (
                  <p className={styles.bookDescription}>
                    {request.description}
                  </p>
                )}

                {/* Notes */}
                {(request.adminComment || request.userComment || request.statusHistory?.length > 1) && (
                  <div className={styles.notesSection}>
                    {request.adminComment && (
                      <div className={styles.adminComment}>
                        <span className={styles.adminCommentLabel}>Note admin</span>
                        <p>{request.adminComment}</p>
                      </div>
                    )}

                    {request.userComment && (
                      <div className={styles.userCommentDisplay}>
                        <span className={styles.userCommentLabel}>Ma note</span>
                        <p>{request.userComment}</p>
                      </div>
                    )}

                    {request.statusHistory?.length > 1 && (
                      <div className={styles.historyBlock}>
                        <button
                          className={styles.historyToggle}
                          onClick={() => setExpandedHistory(expandedHistory === request._id ? null : request._id)}
                        >
                          Historique {expandedHistory === request._id ? '▲' : '▼'}
                        </button>
                        {expandedHistory === request._id && (
                          <div className={styles.historyList}>
                            {[...request.statusHistory].reverse().map((h, i) => (
                              <div key={i} className={styles.historyItem}>
                                <span className={styles.historyStatus}>{
                                  h.status === 'pending' ? '⏳ En attente' :
                                  h.status === 'completed' ? '✅ Complétée' :
                                  h.status === 'canceled' ? '❌ Annulée' :
                                  h.status === 'reported' ? '⚠️ Signalée' : h.status
                                }</span>
                                <span className={styles.historyDate}>
                                  {new Date(h.changedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })} {new Date(h.changedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                                  {h.changedBy && <em> · {h.changedBy}</em>}
                                </span>
                                {h.note && <span className={styles.historyNote}>{h.note.replace(/\s*via\s+\S+/gi, '')}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Cancel / Reported info */}
                {request.status === 'canceled' && request.cancelReason && (
                  <div className={styles.cancelReason}>
                    <span className={styles.cancelReasonLabel}>Motif :</span> {request.cancelReason}
                  </div>
                )}
                {request.status === 'reported' && request.reportReason && (
                  <div className={styles.reportedNotice}>
                    <span className={styles.reportedLabel}>⚠️ Problème signalé</span>
                    <p>{request.reportReason}</p>
                  </div>
                )}
                {/* Action strip */}
                <div className={styles.actionStrip}>
                  <div className={styles.actionIcons}>
                    {request.link && (
                      <a href={request.link} className={styles.iconBtn} target="_blank" rel="noopener noreferrer" title="Voir plus d'informations">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                          <polyline points="15 3 21 3 21 9"/>
                          <line x1="10" y1="14" x2="21" y2="3"/>
                        </svg>
                      </a>
                    )}

                    {request.status === 'completed' && (request.downloadLink || request.filePath) && (
                      <>
                        {isReadable(request.filePath) && (
                          <button
                            className={`${styles.iconBtn} ${styles.iconBtnSuccess}`}
                            onClick={() => setReaderRequest({ title: request.title, requestId: { _id: request._id, filePath: request.filePath, downloadLink: request.downloadLink } })}
                            title="Lire"
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
                            </svg>
                          </button>
                        )}
                        <button
                          className={`${styles.iconBtn} ${styles.iconBtnPrimary}`}
                          onClick={() => setDownloadModalRequest(request)}
                          title="Télécharger"
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                          </svg>
                        </button>
                        {(calibreEnabled || extraTargetCandidates.length > 0) && (
                          <button className={styles.iconBtn} onClick={() => openShelfModal(request)} title="Envoyer vers des étagères Calibre-Web">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 3v18h18"/><path d="M3 8h18"/><path d="M3 13h18"/><path d="M3 18h18"/>
                            </svg>
                          </button>
                        )}
                        <button className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={() => setReportModal({ isOpen: true, requestId: request._id, requestTitle: request.title })} title="Signaler un problème">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
                            <line x1="4" y1="22" x2="4" y2="15"/>
                          </svg>
                        </button>
                      </>
                    )}

                    <button className={`${styles.iconBtn} ${styles.iconBtnNote}`} onClick={() => setThreadModal(request)} title="Messages" style={{ position: 'relative' }}>
                      {request.comments?.some(c => c.role === 'admin' && !c.seenByUser) && (
                        <span style={{ position: 'absolute', top: 2, right: 2, width: 6, height: 6, borderRadius: '50%', background: '#ef4444' }} />
                      )}
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                      </svg>
                    </button>
                    {request.status === 'pending' && (
                      <button className={`${styles.iconBtn} ${styles.iconBtnEdit}`} onClick={() => openEditModal(request)} title="Modifier la demande">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                    )}
                    {['pending', 'canceled'].includes(request.status) && (
                      <button className={`${styles.iconBtn} ${styles.iconBtnDelete}`} onClick={() => setDeleteModal(request)} title="Supprimer la demande">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                          <path d="M10 11v6"/><path d="M14 11v6"/>
                          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                        </svg>
                      </button>
                    )}
                  </div>

                  <span className={styles.requestDate}>
                    {new Date(request.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                    {request.downloadedAt && (
                      <span className={styles.downloadedDate} title={`Téléchargé le ${new Date(request.downloadedAt).toLocaleDateString('fr-FR')}`}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                          <polyline points="7 10 12 15 17 10"/>
                          <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                      </span>
                    )}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
        )}

        {/* Pagination */}
        {filteredRequests.length > ITEMS_PER_PAGE && (
          <div className={styles.pagination}>
            <button
              className={styles.pageButton}
              onClick={() => setCurrentPage(p => Math.max(p - 1, 1))}
              disabled={currentPage === 1}
            >
              <span className={styles.btnLabel}>← Précédent</span><span className={styles.btnIcon}>←</span>
            </button>
            <span className={styles.pageInfo}>
              Page {currentPage} / {Math.ceil(filteredRequests.length / ITEMS_PER_PAGE)}
            </span>
            <button
              className={styles.pageButton}
              onClick={() => setCurrentPage(p => Math.min(p + 1, Math.ceil(filteredRequests.length / ITEMS_PER_PAGE)))}
              disabled={currentPage === Math.ceil(filteredRequests.length / ITEMS_PER_PAGE)}
            >
              <span className={styles.btnLabel}>Suivant →</span><span className={styles.btnIcon}>→</span>
            </button>
          </div>
        )}
        </>
      )}

      {/* Modal suppression */}
      {deleteModal && (
        <div className={styles.modalOverlay} onClick={() => setDeleteModal(null)}>
          <div className={styles.modalContent} ref={deleteModalRef} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Supprimer la demande">
            <h2>Supprimer la demande</h2>
            <p className={styles.modalBookTitle}>« {deleteModal.title} »</p>
            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginBottom: '1.25rem' }}>
              Cette action est irréversible.
            </p>
            <div className={styles.modalButtons}>
              <button className={styles.modalCancelButton} onClick={() => setDeleteModal(null)}>Annuler</button>
              <button className={styles.modalDeleteButton} onClick={handleDeleteRequest}>Supprimer</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal étagères Calibre-Web (a posteriori) */}
      {shelfModalRequest && (
        <div className={styles.modalOverlay} onClick={() => !shelfModalSaving && setShelfModalRequest(null)}>
          <div className={styles.modalContent} ref={shelfModalRef} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Envoyer vers des étagères">
            <h2>Envoyer vers des étagères</h2>
            <p className={styles.modalBookTitle}>« {shelfModalRequest.title} »</p>
            {shelfModalChecking && (
              <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', margin: '0.25rem 0 0.75rem' }}>
                Vérification de l'état réel sur Calibre-Web…
              </p>
            )}
            {calibreShelves.length === 0 ? (
              <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginBottom: '1.25rem' }}>
                Aucune étagère configurée — ajoutez-en dans les Réglages.
              </p>
            ) : (
              <div style={{ margin: '1rem 0 1.25rem' }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--color-text-muted)' }}>
                  Mes étagères
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {calibreShelves.map(s => (
                    <label key={s.name} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', cursor: 'pointer' }}>
                      <input type="checkbox" checked={shelfModalSelection.includes(s.name)} onChange={() => toggleShelfModalSelection(s.name)} />
                      {s.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
            {extraTargetCandidates.length > 0 && (
              <div style={{ margin: calibreShelves.length ? '0 0 1.25rem' : '1rem 0 1.25rem', paddingTop: calibreShelves.length ? '0.75rem' : 0, borderTop: calibreShelves.length ? '1px solid var(--color-border)' : 'none' }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--color-text-muted)' }}>
                  Autres étagères
                </div>
                {extraTargetCandidates.map(u => (
                  <div key={u._id} style={{ marginBottom: '0.5rem' }}>
                    <div style={{ fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.2rem' }}>Étagères de {u.username} :</div>
                    {(u.shelves || []).length === 0 ? (
                      <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', paddingLeft: '0.5rem' }}>Aucune étagère configurée</div>
                    ) : u.shelves.map(s => (
                      <label key={s.name} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.15rem 0 0.15rem 0.5rem', fontSize: '0.87rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={(extraShelfSelections[u._id] || []).includes(s.name)}
                          onChange={() => toggleExtraShelf(u._id, s.name)}
                        />
                        {s.name}
                      </label>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {shelfModalError && (
              <p style={{ fontSize: '0.83rem', color: 'var(--color-danger, #ef4444)', marginBottom: '1rem' }}>{shelfModalError}</p>
            )}
            <div className={styles.modalButtons}>
              <button className={styles.modalCancelButton} onClick={() => setShelfModalRequest(null)} disabled={shelfModalSaving}>Annuler</button>
              <button className={styles.modalSubmitButton} onClick={handleSaveShelves} disabled={shelfModalSaving || (calibreShelves.length === 0 && extraTargetCandidates.length === 0)}>
                {shelfModalSaving ? 'Envoi…' : 'Envoyer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal édition */}
      {editModal && (
        <div className={styles.modalOverlay} onClick={() => !editSaving && setEditModal(null)}>
          <div className={styles.modalContent} ref={editModalRef} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Modifier la demande">
            <h2>Modifier la demande</h2>
            <p className={styles.modalBookTitle}>Demande en attente</p>
            <div className={styles.modalForm}>
              <div className={styles.editFieldRow}>
                <label className={styles.editLabel}>Titre *</label>
                <input
                  className={styles.editInput}
                  value={editForm.title}
                  onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="Titre du livre"
                />
              </div>
              <div className={styles.editFieldRow}>
                <label className={styles.editLabel}>Auteur *</label>
                <input
                  className={styles.editInput}
                  value={editForm.author}
                  onChange={e => setEditForm(f => ({ ...f, author: e.target.value }))}
                  placeholder="Nom de l'auteur"
                />
              </div>
              <div className={styles.editFieldRow}>
                <label className={styles.editLabel}>Format</label>
                <select
                  className={styles.editInput}
                  value={editForm.format}
                  onChange={e => setEditForm(f => ({ ...f, format: e.target.value }))}
                >
                  <option value="">— Non précisé —</option>
                  {['epub', 'mobi', 'azw3', 'fb2', 'cbz', 'cbr', 'pdf'].map(fmt => (
                    <option key={fmt} value={fmt}>{fmt.toUpperCase()}</option>
                  ))}
                </select>
              </div>
              <div className={styles.editFieldRow}>
                <label className={styles.editLabel}>Lien</label>
                <input
                  className={styles.editInput}
                  value={editForm.link}
                  onChange={e => setEditForm(f => ({ ...f, link: e.target.value }))}
                  placeholder="https://..."
                />
              </div>
              <div className={styles.editFieldRow}>
                <label className={styles.editLabel}>Date de sortie</label>
                <input
                  className={styles.editInput}
                  value={editForm.publishedDate}
                  onChange={e => setEditForm(f => ({ ...f, publishedDate: e.target.value }))}
                  placeholder="2024, 06/2024 ou 15/06/2024"
                />
              </div>
              <div className={styles.editFieldRow}>
                <label className={styles.editLabel}>Couverture</label>
                <div className={styles.coverEditRow}>
                  {editForm.thumbnail ? (
                    <div className={styles.coverEditImgWrap} onClick={() => setEditForm(f => ({ ...f, thumbnail: '' }))}>
                      <img src={editForm.thumbnail} alt="Couverture" className={styles.coverEditPreview} />
                      <div className={styles.coverEditOverlay}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                      </div>
                    </div>
                  ) : (
                    <div className={styles.coverEditPlaceholder}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                    </div>
                  )}
                  <div className={styles.coverEditActions}>
                    <label className={styles.coverEditBtn}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginRight: '6px' }}><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
                      Choisir une image
                      <input type="file" accept="image/*" onChange={handleEditCoverChange} style={{ display: 'none' }} />
                    </label>
                  </div>
                </div>
                <span className={styles.coverEditHint}>Recommandé : 200 × 300 px</span>
              </div>
            </div>
            <div className={styles.modalButtons}>
              <button className={styles.modalCancelButton} onClick={() => setEditModal(null)} disabled={editSaving}>Annuler</button>
              <button className={styles.modalSubmitButton} onClick={handleEditRequest} disabled={editSaving || !editForm.title.trim() || !editForm.author.trim()}>
                {editSaving ? 'Sauvegarde…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de signalement */}
      {reportModal.isOpen && (
        <div className={styles.modalOverlay} onClick={() => {
          setReportModal({ isOpen: false, requestId: null, requestTitle: '' });
          setReportReason('');
        }}>
          <div className={styles.modalContent} ref={reportModalRef} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Signaler un problème">
            <h2>Signaler un problème</h2>
            <p className={styles.modalBookTitle}>Livre: {reportModal.requestTitle}</p>
            <div className={styles.modalForm}>
              <label htmlFor="reportReason">Veuillez décrire le problème rencontré:</label>
              <textarea
                id="reportReason"
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value)}
                placeholder="Ex: Le fichier est corrompu, mauvais format, contenu incomplet, etc."
                rows="5"
                className={styles.modalTextarea}
              />
            </div>
            <div className={styles.modalButtons}>
              <button
                className={styles.modalCancelButton}
                onClick={() => {
                  setReportModal({ isOpen: false, requestId: null, requestTitle: '' });
                  setReportReason('');
                }}
              >
                Annuler
              </button>
              <button
                className={styles.modalSubmitButton}
                onClick={handleReportRequest}
                disabled={!reportReason.trim()}
              >
                Envoyer le signalement
              </button>
            </div>
          </div>
        </div>
      )}

      {readerRequest && (
        <BookReaderModal
          book={readerRequest}
          onClose={() => setReaderRequest(null)}
        />
      )}

      {downloadModalRequest && (
        <DownloadModal
          request={downloadModalRequest}
          onClose={() => setDownloadModalRequest(null)}
        />
      )}
    </div>
  );
};

export default UserDashboard;