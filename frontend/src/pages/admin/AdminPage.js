import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import axiosAdmin from '../../axiosAdmin';
import styles from './AdminPage.module.css';
import { toast } from 'react-toastify';
import NotificationsConfig from '../../components/admin/NotificationsConfig';
import UserManagement from '../../components/admin/UserManagement';
import StatsDashboard from '../../components/admin/StatsDashboard';
import BestsellerManagement from '../../components/admin/BestsellerManagement';
import BroadcastMessage from '../../components/admin/BroadcastMessage';
import UpdatesPanel from '../../components/admin/UpdatesPanel';
import EmailLogsPanel from '../../components/admin/EmailLogsPanel';
import OPDSPanel from '../../components/admin/OPDSPanel';
import InvitationsPanel from '../../components/admin/InvitationsPanel';
import ConnectorsPanel from '../../components/admin/ConnectorsPanel';
import ServicesHealth from '../../components/admin/ServicesHealth';
import DownloadLogs from '../../components/admin/DownloadLogs';
import BookPreviewModal from '../../components/BookPreviewModal';
import BookReaderModal from '../../components/BookReaderModal';
import DownloadModal from '../../components/DownloadModal';

const READABLE_EXTS = ['pdf', 'epub', 'cbz', 'cbr'];
const isReadable = (filePath) => {
  if (!filePath) return false;
  const ext = filePath.split(/[\\/]/).pop().split('.').pop().toLowerCase();
  return READABLE_EXTS.includes(ext);
};

const TrashIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
  </svg>
);

const RefreshIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10"></polyline>
    <polyline points="1 20 1 14 7 14"></polyline>
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
  </svg>
);

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"></polyline>
  </svg>
);

const EditIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
  </svg>
);

const ClockIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"></circle>
    <polyline points="12 6 12 12 16 14"></polyline>
  </svg>
);

function AdminPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab   = searchParams.get('tab') || 'requests';
  const highlightId = searchParams.get('highlight');
  const setActiveTab = (tab) => setSearchParams({ tab }, { replace: true });
  const cardRefs    = useRef({});
  const [showPushoverConfig, setShowPushoverConfig] = useState(false);
  const [pushoverConfig, setPushoverConfig] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('pending');
  const filterBarRef = useRef(null);
  const [updatingStatus, setUpdatingStatus] = useState(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deletingRequest, setDeletingRequest] = useState(null);
  const [editingDownloadLink, setEditingDownloadLink] = useState(null);
  const [downloadLink, setDownloadLink] = useState('');
  const [readerRequest, setReaderRequest] = useState(null);
  const [downloadModalRequest, setDownloadModalRequest] = useState(null);
  const [file, setFile] = useState(null);
  const [cancelingRequest, setCancelingRequest] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [predbResults, setPredbResults] = useState({});
  const [checkingPredb, setCheckingPredb] = useState(new Set());
  const [editingComment, setEditingComment] = useState(null);  // utilisé uniquement pour l'historique
  const [commentValue, setCommentValue] = useState('');
  const [commentModal, setCommentModal] = useState(null); // request._id en cours de commentaire admin
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;
  const [previewBook, setPreviewBook] = useState(null);
  const [adminLogs, setAdminLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logSubTab, setLogSubTab] = useState('actions');
  const [systemLogs, setSystemLogs] = useState([]);
  const [systemFilter, setSystemFilter] = useState('all');
  const [followMode, setFollowMode] = useState(true);
  const systemLogsBodyRef = useRef(null);
  const [expandedCards, setExpandedCards] = useState(new Set());
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [uploadsList, setUploadsList] = useState([]);
  const [uploadsLoading, setUploadsLoading] = useState(false);
  const [uploadsSearch, setUploadsSearch] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [connectorsModal, setConnectorsModal] = useState(null); // { _id, title, author }
  const [connectorsQuery, setConnectorsQuery] = useState('');
  const [valentineResults, setValentineResults] = useState(null);
  const [valentineLoading, setValentineLoading] = useState(false);
  const [valentineDownloading, setValentineDownloading] = useState(null);
  const [valentineModalQuota, setValentineModalQuota] = useState(null);
  const [annasResults, setAnnasResults] = useState(null);
  const [annasLoading, setAnnasLoading] = useState(false);
  const [annasDownloading, setAnnasDownloading] = useState(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileNavRef = useRef(null);
  const [viewMode, setViewMode] = useState(() => localStorage.getItem('ebookrequest_view_admin') || 'cards');
  const [expandedTableRows, setExpandedTableRows] = useState(new Set());
  const [sortConfig, setSortConfig] = useState({ key: null, dir: 'asc' });

  const toggleSort = (key) => {
    setSortConfig(prev => prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'asc' }
    );
    setCurrentPage(1);
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

  const setView = (mode) => {
    setViewMode(mode);
    localStorage.setItem('ebookrequest_view_admin', mode);
  };

  const toggleTableRow = (id) => {
    setExpandedTableRows(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const openConnectorsModal = (request) => {
    setConnectorsModal(request);
    setConnectorsQuery(request.title);
    setValentineResults(null);
    setAnnasResults(null);
    setValentineDownloading(null);
    setValentineModalQuota(null);
    axiosAdmin.get('/api/connectors/valentine/quota')
      .then(res => setValentineModalQuota(res.data))
      .catch(() => {});
  };

  const closeConnectorsModal = () => {
    setConnectorsModal(null);
    setValentineResults(null);
    setAnnasResults(null);
    setValentineLoading(false);
    setAnnasLoading(false);
    setValentineDownloading(null);
    setAnnasDownloading(null);
    setValentineModalQuota(null);
  };

  const runConnectorsSearch = async (query) => {
    setValentineResults(null);
    setAnnasResults(null);
    // Search both in parallel
    setValentineLoading(true);
    setAnnasLoading(true);
    axiosAdmin.get(`/api/connectors/valentine/search?q=${encodeURIComponent(query)}`)
      .then(res => setValentineResults(res.data.results))
      .catch(() => setValentineResults([]))
      .finally(() => setValentineLoading(false));
    axiosAdmin.get(`/api/connectors/annasarchive/search?q=${encodeURIComponent(query)}`)
      .then(res => setAnnasResults(res.data.results))
      .catch(() => setAnnasResults([]))
      .finally(() => setAnnasLoading(false));
  };

  const downloadFromValentine = async (ebookId) => {
    if (!connectorsModal) return;
    setValentineDownloading(ebookId);
    try {
      await axiosAdmin.post('/api/connectors/valentine/download-request', { requestId: connectorsModal._id, ebookId });
      toast.success('Téléchargement lancé avec succès');
      closeConnectorsModal();
      fetchRequests();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors du téléchargement');
      setValentineDownloading(null);
    }
  };

  const downloadFromAnnasArchive = async (md5, format) => {
    if (!connectorsModal) return;
    setAnnasDownloading(md5);
    try {
      await axiosAdmin.post('/api/connectors/annasarchive/download', { requestId: connectorsModal._id, md5, format: format || null });
      toast.success('Téléchargement lancé avec succès');
      closeConnectorsModal();
      fetchRequests();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors du téléchargement');
      setAnnasDownloading(null);
    }
  };

  const toggleExpand = (id) => setExpandedCards(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const fetchRequests = async () => {
    try {
      setLoading(true);
      const response = await axiosAdmin.get(`/api/requests/all?status=${filter}`);
      setRequests(response.data);
    } catch (error) {
      console.error('Erreur lors de la récupération des demandes:', error);
      toast.error('Erreur lors du chargement des demandes');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveDownloadLink = async (id, link, fileToUpload) => {
    try {
      const formData = new FormData();
      
      if (fileToUpload) {
        setUploadingFile(true);
        setUploadProgress(0);
        formData.append('file', fileToUpload);
      } else if (link) {
        formData.append('downloadLink', link);
      } else {
        throw new Error('Un fichier ou un lien est requis');
      }
      
      await axiosAdmin.patch(`/api/requests/${id}/download-link`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        },
        onUploadProgress: (progressEvent) => {
          if (fileToUpload) {
            const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setUploadProgress(progress);
          }
        }
      });
      
      setFile(null);
      setDownloadLink('');
      setEditingDownloadLink(null);
      setShowFileBrowser(false);
      setUploadingFile(false);
      setUploadProgress(0);
      await fetchRequests();
      
      // Ajouter un petit délai pour s'assurer que tout est bien chargé
      setTimeout(() => {
        toast.success('Fichier téléversé avec succès !', {
          position: "top-right",
          autoClose: 5000,
          hideProgressBar: false,
          closeOnClick: true,
          pauseOnHover: true,
          draggable: true,
          progress: undefined,
          className: styles.toastSuccess
        });
      }, 500);
    } catch (error) {
      console.error('Error saving download link:', error);
      setUploadingFile(false);
      setUploadProgress(0);
      toast.error(error.response?.data?.error || 'Erreur lors de la sauvegarde du téléchargement');
    }
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      // Vérifier la taille du fichier (max 500MB)
      if (selectedFile.size > 500 * 1024 * 1024) {
        toast.error('Le fichier est trop volumineux (max 500MB)');
        return;
      }
      
      // Vérifier l'extension du fichier
      const validExtensions = [
        // Ebooks
        'pdf', 'epub', 'mobi', 'azw', 'azw3', 'kfx',
        // Archives pour BD/Comics
        'cbz', 'cbr', 'cb7', 'cbt', 'cba', 'djvu',
        // Documents
        'doc', 'docx', 'txt', 'rtf', 'odt',
        // Images pour BD/Comics
        'jpg', 'jpeg', 'png', 'webp', 'gif'
      ];
      
      const fileExt = selectedFile.name.split('.').pop().toLowerCase();
      
      if (!validExtensions.includes(fileExt)) {
        toast.error(
          'Format de fichier non supporté. ' +
          'Formats acceptés: ' +
          'PDF, EPUB, MOBI, AZW, AZW3, KFX, ' +
          'CBZ, CBR, CB7, CBT, CBA, DJVU, ' +
          'DOC, DOCX, TXT, RTF, ODT, ' +
          'JPG, JPEG, PNG, WEBP, GIF'
        );
        return;
      }
      
      setFile(selectedFile);
      setDownloadLink('');
    }
  };

  const fetchUploadsList = async () => {
    setUploadsLoading(true);
    try {
      const res = await axiosAdmin.get('/api/admin/uploads-list');
      if (res.data.success) setUploadsList(res.data.files);
    } catch (e) {
      console.error('Erreur chargement liste uploads:', e);
    } finally {
      setUploadsLoading(false);
    }
  };

  const handleSelectExistingFile = async (id, filePath) => {
    try {
      const formData = new FormData();
      formData.append('existingFilePath', filePath);
      await axiosAdmin.patch(`/api/requests/${id}/download-link`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setEditingDownloadLink(null);
      setShowFileBrowser(false);
      setUploadsSearch('');
      await fetchRequests();
      toast.success('Fichier existant associé avec succès !');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Erreur lors de l\'association du fichier');
    }
  };

  const fetchAdminLogs = async () => {
    setLogsLoading(true);
    try {
      const res = await axiosAdmin.get('/api/admin/logs?limit=100');
      if (res.data.success) setAdminLogs(res.data.logs);
    } catch (e) {
      console.error('Erreur chargement logs:', e);
    } finally {
      setLogsLoading(false);
    }
  };

  const fetchSystemLogs = async () => {
    try {
      const res = await axiosAdmin.get('/api/admin/logs/system');
      setSystemLogs(res.data.logs || []);
    } catch (e) {
      console.error('Erreur chargement logs système:', e);
    }
  };

  const getSystemFilteredLogs = () => {
    let logs = systemLogs;
    if (systemFilter === 'annas') {
      logs = logs.filter(l => l.msg.includes('[Annas]'));
    } else if (systemFilter === 'valentine') {
      logs = logs.filter(l => l.msg.includes('[Valentine]') || l.msg.includes('[Orchestrateur]'));
    } else if (systemFilter === 'cron') {
      logs = logs.filter(l => l.msg.includes('[Cron]') || l.msg.includes('[Connecteurs'));
    } else if (systemFilter === 'error') {
      logs = logs.filter(l => l.level === 'error' || l.level === 'warn');
    }
    return logs.slice(-500);
  };

  const formatLogTime = (isoTs) => {
    const d = new Date(isoTs);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  };

  // SSE : abonnement quand sous-onglet "system" est actif et followMode=true
  useEffect(() => {
    if (activeTab !== 'logs' || logSubTab !== 'system' || !followMode) return;

    const token = localStorage.getItem('token');
    if (!token) return;

    const es = new EventSource(`/api/admin/logs/system/stream?token=${encodeURIComponent(token)}`);

    es.onmessage = (e) => {
      try {
        const line = JSON.parse(e.data);
        setSystemLogs(prev => {
          const next = [...prev, line];
          return next.length > 500 ? next.slice(next.length - 500) : next;
        });
      } catch { /* ignorer */ }
    };

    es.onerror = () => {
      es.close();
    };

    return () => {
      es.close();
    };
  }, [activeTab, logSubTab, followMode]);

  // Auto-scroll vers le bas quand followMode est actif
  useEffect(() => {
    if (followMode && systemLogsBodyRef.current) {
      systemLogsBodyRef.current.scrollTop = systemLogsBodyRef.current.scrollHeight;
    }
  }, [systemLogs, followMode]);

  // Charger les logs système au montage du sous-onglet
  useEffect(() => {
    if (activeTab === 'logs' && logSubTab === 'system') {
      fetchSystemLogs();
    }
  }, [activeTab, logSubTab]);

  useEffect(() => {
    if (activeTab === 'requests') {
      setCurrentPage(1);
      fetchRequests();
    } else if (activeTab === 'logs') {
      fetchAdminLogs();
    }
  }, [filter, activeTab]);

  // Scroll + pagination vers la demande mise en surbrillance
  useEffect(() => {
    if (!highlightId || activeTab !== 'requests' || !requests.length) return;
    const idx = requests.findIndex(r => r._id === highlightId);
    if (idx === -1) return;
    const targetPage = Math.floor(idx / ITEMS_PER_PAGE) + 1;
    setCurrentPage(targetPage);
  }, [highlightId, requests, activeTab]); // eslint-disable-line

  useEffect(() => {
    if (!highlightId || activeTab !== 'requests') return;
    const el = cardRefs.current[highlightId];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightId, currentPage, activeTab]);

  // Fermer le dropdown mobile au clic extérieur
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (mobileNavRef.current && !mobileNavRef.current.contains(e.target)) {
        setMobileNavOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleUpdateStatus = async (id, status, reason = '') => {
    try {
      setUpdatingStatus(id);
      await axiosAdmin.patch(`/api/requests/${id}/status`, { status, reason });
      await fetchRequests();
      const statusMessages = {
        'completed': 'complétée',
        'canceled': 'annulée',
        'pending': 'en attente'
      };
      toast.success(`Demande marquée comme ${statusMessages[status] || status}`);
      setCancelingRequest(null);
      setCancelReason('');
    } catch (error) {
      console.error('Erreur lors de la mise à jour du statut:', error);
      toast.error('Erreur lors de la mise à jour du statut');
    } finally {
      setUpdatingStatus(null);
    }
  };

  const handleCancelRequest = (id) => {
    if (cancelReason.trim() === '') {
      toast.error('Veuillez indiquer une raison d\'annulation');
      return;
    }
    handleUpdateStatus(id, 'canceled', cancelReason);
  };

  const handleDeleteRequest = async (id) => {
    if (window.confirm('Êtes-vous sûr de vouloir supprimer cette demande ?')) {
      try {
        setDeletingRequest(id);
        await axiosAdmin.delete(`/api/requests/${id}`);
        await fetchRequests();
        toast.success('Demande supprimée avec succès');
      } catch (error) {
        console.error('Erreur lors de la suppression de la demande:', error);
        toast.error('Erreur lors de la suppression de la demande');
      } finally {
        setDeletingRequest(null);
      }
    }
  };

  const handlePredbCheck = async (request) => {
    setCheckingPredb(prev => new Set([...prev, request._id]));
    try {
      const response = await axiosAdmin.post('/api/availability/check', {
        title: request.title,
        author: request.author
      });
      setPredbResults(prev => ({ ...prev, [request._id]: response.data }));
    } catch (error) {
      setPredbResults(prev => ({ ...prev, [request._id]: { confidence: 'unknown', message: 'Erreur lors de la vérification' } }));
    } finally {
      setCheckingPredb(prev => { const next = new Set(prev); next.delete(request._id); return next; });
    }
  };

  const handleSaveComment = async (id) => {
    try {
      await axiosAdmin.patch(`/api/requests/${id}/comment`, { comment: commentValue });
      setEditingComment(null);
      setCommentModal(null);
      setCommentValue('');
      await fetchRequests();
      toast.success('Commentaire enregistré');
    } catch (error) {
      toast.error('Erreur lors de la sauvegarde du commentaire');
    }
  };

  const actionLabels = {
    cancel: { label: 'Annulation', color: '#f59e0b' },
    complete: { label: 'Complétée', color: '#22c55e' },
    delete: { label: 'Suppression', color: '#ef4444' },
    comment: { label: 'Commentaire', color: '#6366f1' },
    status_change: { label: 'Statut modifié', color: '#94a3b8' },
    upload: { label: 'Fichier uploadé', color: '#3b82f6' },
    resolve_report: { label: 'Signalement résolu', color: '#10b981' },
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case 'stats':
        return <StatsDashboard />;
      case 'pushover':
        return <NotificationsConfig />;
      case 'users':
        return <UserManagement />;
      case 'bestsellers':
        return <BestsellerManagement />;
      case 'broadcast':
        return <BroadcastMessage />;
      case 'invitations':
        return <InvitationsPanel />;
      case 'connectors':
        return <ConnectorsPanel />;
      case 'health':
        return <ServicesHealth />;

      case 'updates':
        return <UpdatesPanel />;
      case 'emails':
        return <EmailLogsPanel />;
      case 'opds':
        return <OPDSPanel />;
      case 'logs':
        return (
          <div className={styles.logsContainer}>
            {/* Sous-onglets */}
            <div className={styles.logSubTabs}>
              <button
                className={`${styles.logSubTab} ${logSubTab === 'actions' ? styles.logSubTabActive : ''}`}
                onClick={() => setLogSubTab('actions')}
              >
                Actions
              </button>
              <button
                className={`${styles.logSubTab} ${logSubTab === 'system' ? styles.logSubTabActive : ''}`}
                onClick={() => setLogSubTab('system')}
              >
                Connecteurs
              </button>
              <button
                className={`${styles.logSubTab} ${logSubTab === 'downloads' ? styles.logSubTabActive : ''}`}
                onClick={() => setLogSubTab('downloads')}
              >
                Téléchargements
              </button>
            </div>

            {logSubTab === 'actions' && (
              <>
                <div className={styles.logsHeader}>
                  <button className={styles.refreshLogsBtn} onClick={fetchAdminLogs} title="Rafraîchir">
                    <RefreshIcon />
                  </button>
                </div>
                {logsLoading ? (
                  <div className={styles.loading}>Chargement...</div>
                ) : adminLogs.length === 0 ? (
                  <div className={styles.noResults}>Aucun log disponible</div>
                ) : (
                  <div className={styles.logsTableWrapper}>
                    <table className={styles.logsTable}>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Admin</th>
                          <th>Action</th>
                          <th>Livre</th>
                          <th>Utilisateur</th>
                          <th>Détails</th>
                        </tr>
                      </thead>
                      <tbody>
                        {adminLogs.map(log => {
                          const meta = actionLabels[log.action] || { label: log.action, color: '#94a3b8' };
                          return (
                            <tr key={log._id}>
                              <td className={styles.logDate}>
                                {new Date(log.createdAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </td>
                              <td className={styles.logAdmin}>{log.adminUsername}</td>
                              <td>
                                <span className={styles.logBadge} style={{ background: `${meta.color}22`, color: meta.color, borderColor: `${meta.color}44` }}>
                                  {meta.label}
                                </span>
                              </td>
                              <td className={styles.logTitle}>{log.requestTitle || '—'}</td>
                              <td className={styles.logUser}>{log.targetUser || '—'}</td>
                              <td className={styles.logDetails}>{log.details || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {logSubTab === 'system' && (() => {
              const filteredLogs = getSystemFilteredLogs();
              return (
                <div className={styles.systemLogsContainer}>
                  <div className={styles.systemLogsToolbar}>
                    <select
                      className={styles.systemLogsSelect}
                      value={systemFilter}
                      onChange={e => setSystemFilter(e.target.value)}
                    >
                      <option value="all">Tous les logs</option>
                      <option value="annas">Anna's Archive</option>
                      <option value="valentine">Valentine</option>
                      <option value="cron">Cron</option>
                      <option value="error">Erreurs</option>
                    </select>
                    <div className={styles.systemLogsActions}>
                      <button
                        className={styles.refreshLogsBtn}
                        onClick={fetchSystemLogs}
                        title="Recharger le buffer"
                      >
                        <RefreshIcon />
                      </button>
                      <button
                        className={`${styles.systemLogsFollowBtn} ${followMode ? styles.systemLogsFollowBtnActive : ''}`}
                        onClick={() => setFollowMode(v => !v)}
                        title={followMode ? 'Désactiver le suivi automatique' : 'Activer le suivi automatique'}
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                          <circle cx="8" cy="8" r={followMode ? 8 : 6} stroke="currentColor" strokeWidth={followMode ? 0 : 2} fill={followMode ? 'currentColor' : 'none'} />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div className={styles.systemLogsBody} ref={systemLogsBodyRef}>
                    {filteredLogs.length === 0 ? (
                      <div className={styles.systemLogsEmpty}>Aucun log{systemFilter !== 'all' ? ' pour ce filtre' : ''}</div>
                    ) : (
                      filteredLogs.map(line => (
                        <div
                          key={line.id}
                          className={styles.systemLogLine}
                          data-level={line.level}
                        >
                          <span className={styles.systemLogTime}>[{formatLogTime(line.ts)}]</span>
                          {' '}{line.msg}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })()}
            {logSubTab === 'downloads' && <DownloadLogs />}
          </div>
        );
      case 'requests':
      default:
        return (
          <>
            <div className={styles.filterBarWrapper}>
              <div className={styles.filterBar} ref={filterBarRef}>
                {[
                  { key: 'pending',   label: 'En attente',   color: '#f59e0b' },
                  { key: 'completed', label: 'Complétées',   color: '#10b981' },
                  { key: 'reported',  label: 'Signalements', color: '#8b5cf6' },
                  { key: 'canceled',  label: 'Annulées',     color: '#ef4444' },
                  { key: 'all',       label: 'Toutes',       color: null },
                ].map(({ key, label, color }) => {
                  const isActive = filter === key;
                  return (
                    <button
                      key={key}
                      className={`${styles.filterPill} ${isActive ? styles.filterPillActive : ''}`}
                      style={isActive && color ? { background: color + '1a', color } : {}}
                      onClick={() => {
                        const savedScroll = filterBarRef.current?.scrollLeft ?? 0;
                        setFilter(key);
                        setUserFilter('');
                        requestAnimationFrame(() => {
                          if (filterBarRef.current) filterBarRef.current.scrollLeft = savedScroll;
                        });
                      }}
                    >
                      {color && <span className={styles.filterDot} style={{ background: color }}/>}
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className={styles.userFilterWrap}>
              <span className={styles.userFilterIcon}>
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
              </span>
              <input
                className={styles.userFilterInput}
                type="text"
                placeholder="Rechercher par utilisateur..."
                value={userFilter}
                list="user-list"
                onChange={e => { setUserFilter(e.target.value); setCurrentPage(1); }}
              />
              <datalist id="user-list">
                {[...new Set(requests.map(r => r.username).filter(Boolean))].sort().map(u => <option key={u} value={u} />)}
              </datalist>
            </div>
            <div className={styles.requestsToolbar}>
              <button
                className={styles.refreshButton}
                onClick={fetchRequests}
                disabled={loading}
              >
                <RefreshIcon />
              </button>
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
            {renderRequestsList()}
          </>
        );
    }
  };

  const getFileType = (filename) => {
    if (!filename) return '';
    const ext = filename.split('.').pop().toLowerCase();
    return ext.toUpperCase();
  };

  const renderRequestsList = () => {
    const STATUS_ORDER = { reported: 1, completed: 2, pending: 3, canceled: 4 };
    const base = userFilter
      ? requests.filter(r => r.username?.toLowerCase().includes(userFilter.toLowerCase()))
      : requests;
    const filtered = sortConfig.key ? [...base].sort((a, b) => {
      let va, vb;
      if (sortConfig.key === 'status')    { va = STATUS_ORDER[a.status] ?? 9; vb = STATUS_ORDER[b.status] ?? 9; }
      else if (sortConfig.key === 'createdAt') { va = new Date(a.createdAt); vb = new Date(b.createdAt); }
      else { va = (a[sortConfig.key] || '').toLowerCase(); vb = (b[sortConfig.key] || '').toLowerCase(); }
      if (va < vb) return sortConfig.dir === 'asc' ? -1 : 1;
      if (va > vb) return sortConfig.dir === 'asc' ? 1 : -1;
      return 0;
    }) : base;
    const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
    const paginated = filtered.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);
    return (
      <div className={styles.requestsList}>
        {loading ? (
          <div className={styles.loading}>Chargement des demandes...</div>
        ) : filtered.length === 0 ? (
          <div className={styles.noResults}>
            <svg width="36" height="36" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.35 }}>
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
            </svg>
            <span>Aucune demande trouvée{userFilter ? ` pour « ${userFilter} »` : ''}</span>
          </div>
        ) : viewMode === 'table' ? (
          <div className={styles.adminTableWrapper}>
            <table className={styles.adminTable}>
              <thead>
                <tr>
                  {[
                    { label: 'Titre / Auteur', key: 'title' },
                    { label: 'Utilisateur',    key: 'username' },
                    { label: 'Format',         key: 'format' },
                    { label: 'Statut',         key: 'status' },
                    { label: 'Date',           key: 'createdAt' },
                  ].map(({ label, key }) => (
                    <th key={key} className={`${styles.adminTh} ${styles.adminThSortable}`} onClick={() => toggleSort(key)}>
                      {label}<SortIcon colKey={key} />
                    </th>
                  ))}
                  <th className={styles.adminTh} style={{ width: '1%', whiteSpace: 'nowrap' }}>Badges</th>
                  <th className={styles.adminTh} style={{ width: '1%', whiteSpace: 'nowrap' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map(request => {
                  const isExpanded = expandedCards.has(request._id)
                    || cancelingRequest === request._id
                    || !!predbResults[request._id]
                    || expandedTableRows.has(request._id);
                  return (
                    <React.Fragment key={request._id}>
                      <tr
                        ref={el => { cardRefs.current[request._id] = el; }}
                        className={`${styles.adminTableRow} ${isExpanded ? styles.adminTableRowExpanded : ''} ${highlightId === request._id ? styles.cardHighlight : ''}`}
                        onClick={() => { toggleExpand(request._id); toggleTableRow(request._id); }}
                      >
                        <td className={styles.adminTd}>
                          <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{request.title}</div>
                          <div style={{ fontSize: '0.76rem', color: 'var(--color-text-muted)' }}>{request.author}</div>
                        </td>
                        <td className={styles.adminTd} style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>{request.username}</td>
                        <td className={styles.adminTd}>
                          {request.format ? <span className={styles.formatBadge}>{request.format.toUpperCase()}</span> : '—'}
                        </td>
                        <td className={styles.adminTd}>
                          <span className={`${styles.status} ${
                            request.status === 'completed' ? styles.completed :
                            request.status === 'canceled' ? styles.canceled :
                            request.status === 'reported' ? styles.reported : ''
                          }`}>
                            {request.status === 'pending' ? 'En attente' :
                             request.status === 'completed' ? 'Complétée' :
                             request.status === 'reported' ? 'Signalée' : 'Annulée'}
                          </span>
                        </td>
                        <td className={styles.adminTd} style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                          {new Date(request.createdAt).toLocaleDateString('fr-FR')}
                        </td>
                        <td className={styles.adminTd} onClick={e => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center', flexWrap: 'nowrap' }}>
                            {(() => {
                              const cats = ['ebook', 'manga', 'comic'];
                              const labels = { ebook: 'Roman', manga: 'Manga', comic: 'Comic' };
                              const cur = cats.includes(request.category) ? request.category : 'ebook';
                              const next = cats[(cats.indexOf(cur) + 1) % cats.length];
                              return (
                                <span
                                  className={`${styles.categoryMetaTag} ${styles[`categoryMetaTag_${cur}`]}`}
                                  title={`Changer → ${labels[next]}`}
                                  onClick={async e => {
                                    e.stopPropagation();
                                    try {
                                      await axiosAdmin.patch(`/api/requests/${request._id}/category`, { category: next }, {
                                        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
                                      });
                                      setRequests(prev => prev.map(r => r._id === request._id ? { ...r, category: next } : r));
                                    } catch { toast.error('Erreur lors de la mise à jour de la catégorie'); }
                                  }}
                                >
                                  {labels[cur]}
                                </span>
                              );
                            })()}
                            {request.downloadedAt && (
                              <span className={`${styles.adminMetaItem} ${styles.adminMetaDownloaded}`} title={`Téléchargé le ${new Date(request.downloadedAt).toLocaleDateString('fr-FR')}`}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                              </span>
                            )}
                            {(request.filePath || request.downloadLink) && (
                              <span className={`${styles.adminMetaItem} ${styles.adminMetaFile}`}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                {request.filePath ? getFileType(request.filePath) : 'Lien'}
                              </span>
                            )}
                            {request.lastAutoAttempt?.date && (
                              <span className={styles.autoAttemptBadge} title={`Dernière tentative auto : ${new Date(request.lastAutoAttempt.date).toLocaleString('fr-FR')}`}>
                                <svg width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                                {request.lastAutoAttempt.connectors.map((c, i) =>
                                  c === 'valentine'
                                    ? <span key={i} className={styles.autoAttemptChip} data-connector="valentine">V</span>
                                    : <span key={i} className={styles.autoAttemptChip} data-connector="annas">A</span>
                                )}
                              </span>
                            )}
                            {request.calibrePush?.status && (
                              <span
                                className={`${styles.calibrePushBadge} ${request.calibrePush.status === 'success' ? styles.calibrePushSuccess : styles.calibrePushFailed}`}
                                title={request.calibrePush.status === 'failed' ? `Calibre: ${request.calibrePush.error}` : 'Envoyé dans Calibre-Web'}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                              </span>
                            )}
                          </div>
                        </td>
                        <td className={styles.adminTd} onClick={e => e.stopPropagation()}>
                          <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                            {request.link && (
                              <a href={request.link} target="_blank" rel="noopener noreferrer" className={styles.aIconBtn} title="Voir le livre">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                              </a>
                            )}
                            {request.status === 'pending' && (
                              <button className={`${styles.aIconBtn} ${styles.aIconBtnPrimary}`} title="Ajouter le fichier"
                                onClick={() => { setEditingDownloadLink(request._id); setDownloadLink(request.downloadLink || ''); setFile(null); }}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                              </button>
                            )}
                            <button
                              className={styles.aIconBtn}
                              onClick={e => { e.stopPropagation(); toggleExpand(request._id); toggleTableRow(request._id); }}
                              title={isExpanded ? 'Réduire' : 'Voir actions'}
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                                <polyline points="6 9 12 15 18 9"/>
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className={styles.adminExpandRow}>
                          <td className={styles.adminExpandCell} colSpan={7}>
                            <div className={styles.adminExpandPanel}>
                              {request.status === 'reported' && request.reportReason && (
                                <div className={styles.reportSection}>
                                  <div className={styles.reportLabel}>⚠️ {request.reportReason}</div>
                                  <div className={styles.reportDate}>{new Date(request.reportedAt).toLocaleDateString('fr-FR')}</div>
                                </div>
                              )}
                              {request.cancelReason && request.status === 'canceled' && (
                                <div className={styles.reportSection}>
                                  <div className={styles.reportLabel}>Motif : {request.cancelReason}</div>
                                </div>
                              )}
                              {predbResults[request._id] && (
                                <div className={`${styles.predbResult} ${
                                  predbResults[request._id].confidence === 'high' ? styles.predbHigh :
                                  predbResults[request._id].confidence === 'medium' ? styles.predbMedium :
                                  predbResults[request._id].confidence === 'low' ? styles.predbLow :
                                  styles.predbUnknown
                                }`}>
                                  <span className={styles.predbIcon}>
                                    {predbResults[request._id].confidence === 'high' && '✓'}
                                    {predbResults[request._id].confidence === 'medium' && '⚡'}
                                    {predbResults[request._id].confidence === 'low' && '⏱'}
                                    {predbResults[request._id].confidence === 'unknown' && '?'}
                                  </span>
                                  <span>{predbResults[request._id].message}</span>
                                  {predbResults[request._id].match?.rssTitle && (
                                    <div className={styles.predbMatch}>{predbResults[request._id].match.rssTitle}</div>
                                  )}
                                </div>
                              )}
                              {request.adminComment && (
                                <div className={styles.existingComment}>
                                  <span className={styles.commentLabel}>Note admin :</span> {request.adminComment}
                                </div>
                              )}
                              {request.userComment && (
                                <div className={styles.userCommentAdmin}>
                                  <span className={styles.commentLabel}>Note utilisateur :</span> {request.userComment}
                                </div>
                              )}
                              {request.statusHistory?.length > 1 && (
                                <div className={styles.historyBlock}>
                                  <button
                                    className={styles.historyToggle}
                                    onClick={() => setEditingComment(prev => prev === `hist_${request._id}` ? null : `hist_${request._id}`)}
                                  >
                                    🕓 Historique {editingComment === `hist_${request._id}` ? '▲' : '▼'}
                                  </button>
                                  {editingComment === `hist_${request._id}` && (
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
                                            {h.changedBy && ` · ${h.changedBy}`}
                                          </span>
                                          {h.note && <span className={styles.historyNote}>{h.note.replace(/\s*via\s+\S+/gi, '')}</span>}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                              <div className={styles.statusButtons}>
                                {isReadable(request.filePath) && (
                                  <button
                                    className={`${styles.aIconBtn} ${styles.aIconBtnSuccess}`}
                                    title="Lire"
                                    onClick={() => setReaderRequest({ title: request.title, requestId: { _id: request._id, filePath: request.filePath, downloadLink: request.downloadLink } })}
                                  >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
                                    </svg>
                                  </button>
                                )}
                                {(request.downloadLink || request.filePath) && (
                                  <button
                                    className={`${styles.aIconBtn} ${styles.aIconBtnPrimary}`}
                                    title="Télécharger"
                                    onClick={() => setDownloadModalRequest(request)}
                                  >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                  </button>
                                )}
                                {(request.downloadLink || request.filePath) && (
                                  <button className={styles.aIconBtn} title="Copier le lien"
                                    onClick={() => {
                                      const link = request.filePath ? `${window.location.origin}/api/requests/download/${request._id}` : request.downloadLink;
                                      navigator.clipboard.writeText(link); toast.success('Lien copié');
                                    }}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                                  </button>
                                )}
                                {(request.downloadLink || request.filePath) && (
                                  <button className={styles.aIconBtn} title="Remplacer le fichier"
                                    onClick={() => { setEditingDownloadLink(request._id); setDownloadLink(request.downloadLink || ''); setFile(null); }}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="12 18 12 12"/><polyline points="9 15 12 12 15 15"/></svg>
                                  </button>
                                )}
                                <button className={styles.aIconBtn} title="Chercher sur PreDB"
                                  onClick={() => handlePredbCheck(request)} disabled={checkingPredb.has(request._id)}>
                                  {checkingPredb.has(request._id) ? <span className={styles.spinner}/> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>}
                                </button>
                                {request.status === 'pending' && (
                                  <button className={`${styles.aIconBtn} ${styles.aIconBtnValentine}`}
                                    title="Rechercher sur les connecteurs"
                                    onClick={() => openConnectorsModal(request)}>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
                                    </svg>
                                  </button>
                                )}
                                <button className={styles.aIconBtn} title={request.adminComment ? 'Modifier la note admin' : 'Ajouter une note admin'}
                                  onClick={() => { setCommentModal(request._id); setCommentValue(request.adminComment || ''); }}>
                                  {request.adminComment
                                    ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                    : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                                  }
                                </button>
                                <span className={styles.btnDivider}/>
                                {request.status === 'pending' && (<>
                                  <button className={`${styles.aIconBtn} ${styles.aIconBtnPrimary}`} title="Ajouter le fichier"
                                    onClick={() => { setEditingDownloadLink(request._id); setDownloadLink(request.downloadLink || ''); setFile(null); }}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                                  </button>
                                  <button className={`${styles.aIconBtn} ${styles.aIconBtnDanger}`} title="Annuler la demande"
                                    onClick={() => setCancelingRequest(request._id)} disabled={updatingStatus === request._id}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                  </button>
                                </>)}
                                {request.status === 'reported' && (<>
                                  <button className={`${styles.aIconBtn} ${styles.aIconBtnPrimary}`} title="Résolu — Compléter"
                                    onClick={() => handleUpdateStatus(request._id, 'completed')} disabled={updatingStatus === request._id}>
                                    {updatingStatus === request._id ? <span className={styles.spinner}/> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                                  </button>
                                  <button className={`${styles.aIconBtn} ${styles.aIconBtnWarning}`} title="Repasser en attente"
                                    onClick={() => handleUpdateStatus(request._id, 'pending')} disabled={updatingStatus === request._id}>
                                    {updatingStatus === request._id ? <span className={styles.spinner}/> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.54"/></svg>}
                                  </button>
                                  <button className={styles.aIconBtn} title="Remplacer le fichier"
                                    onClick={() => { setEditingDownloadLink(request._id); setDownloadLink(request.downloadLink || ''); setFile(null); }}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="12 18 12 12"/><polyline points="9 15 12 12 15 15"/></svg>
                                  </button>
                                </>)}
                                {(request.status === 'completed' || request.status === 'canceled') && (<>
                                  <button className={`${styles.aIconBtn} ${styles.aIconBtnWarning}`} title="Repasser en attente"
                                    onClick={() => handleUpdateStatus(request._id, 'pending')} disabled={updatingStatus === request._id}>
                                    {updatingStatus === request._id ? <span className={styles.spinner}/> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>}
                                  </button>
                                  {request.status === 'completed' && (
                                    <button className={`${styles.aIconBtn} ${styles.aIconBtnDanger}`} title="Annuler la demande"
                                      onClick={() => { setCancelingRequest(request._id); setCancelReason(''); }} disabled={updatingStatus === request._id}>
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                    </button>
                                  )}
                                  {request.status === 'canceled' && (
                                    <button className={`${styles.aIconBtn} ${styles.aIconBtnPrimary}`} title="Réactiver"
                                      onClick={() => handleUpdateStatus(request._id, 'pending')} disabled={updatingStatus === request._id}>
                                      {updatingStatus === request._id ? <span className={styles.spinner}/> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.54"/></svg>}
                                    </button>
                                  )}
                                </>)}
                                <button className={`${styles.aIconBtn} ${styles.aIconBtnDanger}`} title="Supprimer la demande"
                                  onClick={() => handleDeleteRequest(request._id)} disabled={deletingRequest === request._id}>
                                  {deletingRequest === request._id ? <span className={styles.spinner}/> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>}
                                </button>
                              </div>
                              {cancelingRequest === request._id && (
                                <div className={styles.cancelForm}>
                                  <input
                                    type="text"
                                    value={cancelReason}
                                    onChange={(e) => setCancelReason(e.target.value)}
                                    placeholder="Raison de l'annulation"
                                    className={styles.cancelInput}
                                    autoFocus
                                  />
                                  <div className={styles.cancelButtons}>
                                    <button
                                      className={`${styles.button} ${styles.primary}`}
                                      onClick={() => handleCancelRequest(request._id)}
                                      disabled={updatingStatus === request._id}
                                    >
                                      {updatingStatus === request._id ? '...' : 'Confirmer'}
                                    </button>
                                    <button
                                      className={styles.button}
                                      onClick={() => { setCancelingRequest(null); setCancelReason(''); }}
                                    >
                                      Annuler
                                    </button>
                                  </div>
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
        ) : (
          <div className={styles.requestsGrid}>
            {paginated.map(request => {
              const isExpanded = expandedCards.has(request._id)
                || cancelingRequest === request._id
                || !!predbResults[request._id];

              return (
              <div key={request._id}
                ref={el => { cardRefs.current[request._id] = el; }}
                className={`${styles.requestCard} ${highlightId === request._id ? styles.cardHighlight : ''} ${
                request.status === 'completed' ? styles.cardCompleted :
                request.status === 'canceled' ? styles.cardCanceled :
                request.status === 'reported' ? styles.cardReported :
                styles.cardPending
              }`}>
                {/* Cover sidebar */}
                <div className={styles.adminCover} onClick={() => setPreviewBook(request)}>
                  {request.thumbnail ? (
                    <img
                      src={request.thumbnail}
                      alt={`Couverture de ${request.title}`}
                      className={styles.adminCoverImg}
                      onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.nextElementSibling.style.display = 'flex';
                      }}
                    />
                  ) : null}
                  <div className={styles.adminNoCover} style={{ display: request.thumbnail ? 'none' : 'flex' }}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                    </svg>
                  </div>
                </div>

                {/* Content */}
                <div className={styles.adminContent}>
                  {/* Header */}
                  <div className={styles.adminHeader}>
                    <div className={styles.bookTitle}>{request.title}</div>
                    <span className={`${styles.status} ${
                      request.status === 'completed' ? styles.completed :
                      request.status === 'canceled' ? styles.canceled :
                      request.status === 'reported' ? styles.reported : ''
                    }`}>
                      {request.status === 'pending' ? 'En attente' :
                       request.status === 'completed' ? 'Complétée' :
                       request.status === 'reported' ? 'Signalée' : 'Annulée'}
                    </span>
                  </div>

                  <div className={styles.bookAuthor}>
                    {request.author}
                    {request.format && <span className={styles.formatBadge}>{request.format.toUpperCase()}</span>}
                  </div>

                  {/* Meta compact */}
                  <div className={styles.adminMeta}>
                    <span className={styles.adminMetaItem}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                      {request.username}
                    </span>
                    <span className={styles.adminMetaItem}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                      {new Date(request.createdAt).toLocaleDateString('fr-FR')}
                    </span>
                    {(() => {
                      const cats = ['ebook', 'manga', 'comic'];
                      const labels = { ebook: 'Roman', manga: 'Manga', comic: 'Comic' };
                      const cur = cats.includes(request.category) ? request.category : 'ebook';
                      const next = cats[(cats.indexOf(cur) + 1) % cats.length];
                      return (
                        <span
                          className={`${styles.categoryMetaTag} ${styles[`categoryMetaTag_${cur}`]}`}
                          title={`Changer → ${labels[next]}`}
                          onClick={async e => {
                            e.stopPropagation();
                            try {
                              await axiosAdmin.patch(`/api/requests/${request._id}/category`, { category: next }, {
                                headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
                              });
                              setRequests(prev => prev.map(r => r._id === request._id ? { ...r, category: next } : r));
                            } catch { toast.error('Erreur lors de la mise à jour de la catégorie'); }
                          }}
                        >
                          {labels[cur]}
                        </span>
                      );
                    })()}
                    {request.downloadedAt && (
                      <span className={`${styles.adminMetaItem} ${styles.adminMetaDownloaded}`}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        {new Date(request.downloadedAt).toLocaleDateString('fr-FR')}
                      </span>
                    )}
                    {(request.filePath || request.downloadLink) && (
                      <span className={`${styles.adminMetaItem} ${styles.adminMetaFile}`}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                        {request.filePath ? getFileType(request.filePath) : 'Lien'}
                      </span>
                    )}
                    {request.lastAutoAttempt?.date && (
                      <span className={styles.autoAttemptBadge} title={`Dernière tentative auto : ${new Date(request.lastAutoAttempt.date).toLocaleString('fr-FR')}`}>
                        <svg width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                        {request.lastAutoAttempt.connectors.map((c, i) =>
                          c === 'valentine'
                            ? <span key={i} className={styles.autoAttemptChip} data-connector="valentine">V</span>
                            : <span key={i} className={styles.autoAttemptChip} data-connector="annas">A</span>
                        )}
                      </span>
                    )}
                    {request.calibrePush?.status && (
                      <span
                        className={`${styles.calibrePushBadge} ${request.calibrePush.status === 'success' ? styles.calibrePushSuccess : styles.calibrePushFailed}`}
                        title={request.calibrePush.status === 'failed' ? `Calibre: ${request.calibrePush.error}` : 'Envoyé dans Calibre-Web'}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
                      </span>
                    )}
                    {request.link && (
                      <a href={request.link} target="_blank" rel="noopener noreferrer" className={styles.adminMetaLink} onClick={e => e.stopPropagation()} title="Voir le livre">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                      </a>
                    )}
                    {request.adminComment && (
                      <span className={styles.adminMetaItem} title={`Note : ${request.adminComment}`}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                      </span>
                    )}
                  </div>

                  {/* Bouton accordéon */}
                  <button
                    className={`${styles.expandToggle} ${isExpanded ? styles.expandToggleOpen : ''}`}
                    onClick={() => toggleExpand(request._id)}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                    {isExpanded ? 'Réduire' : 'Actions'}
                  </button>

                  {/* Panneau déroulant */}
                  {isExpanded && (
                    <div className={styles.expandedPanel}>
                      {request.status === 'reported' && request.reportReason && (
                        <div className={styles.reportSection}>
                          <div className={styles.reportLabel}>⚠️ {request.reportReason}</div>
                          <div className={styles.reportDate}>{new Date(request.reportedAt).toLocaleDateString('fr-FR')}</div>
                        </div>
                      )}
                      {request.cancelReason && request.status === 'canceled' && (
                        <div className={styles.reportSection}>
                          <div className={styles.reportLabel}>Motif : {request.cancelReason}</div>
                        </div>
                      )}

                      {predbResults[request._id] && (
                        <div className={`${styles.predbResult} ${
                          predbResults[request._id].confidence === 'high' ? styles.predbHigh :
                          predbResults[request._id].confidence === 'medium' ? styles.predbMedium :
                          predbResults[request._id].confidence === 'low' ? styles.predbLow :
                          styles.predbUnknown
                        }`}>
                          <span className={styles.predbIcon}>
                            {predbResults[request._id].confidence === 'high' && '✓'}
                            {predbResults[request._id].confidence === 'medium' && '⚡'}
                            {predbResults[request._id].confidence === 'low' && '⏱'}
                            {predbResults[request._id].confidence === 'unknown' && '?'}
                          </span>
                          <span>{predbResults[request._id].message}</span>
                          {predbResults[request._id].match?.rssTitle && (
                            <div className={styles.predbMatch}>{predbResults[request._id].match.rssTitle}</div>
                          )}
                        </div>
                      )}

                      {request.adminComment && (
                        <div className={styles.existingComment}>
                          <span className={styles.commentLabel}>Note admin :</span> {request.adminComment}
                        </div>
                      )}
                      {request.userComment && (
                        <div className={styles.userCommentAdmin}>
                          <span className={styles.commentLabel}>Note utilisateur :</span> {request.userComment}
                        </div>
                      )}
                      {request.statusHistory?.length > 1 && (
                        <div className={styles.historyBlock}>
                          <button
                            className={styles.historyToggle}
                            onClick={() => setEditingComment(prev => prev === `hist_${request._id}` ? null : `hist_${request._id}`)}
                          >
                            🕓 Historique {editingComment === `hist_${request._id}` ? '▲' : '▼'}
                          </button>
                          {editingComment === `hist_${request._id}` && (
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
                                    {h.changedBy && ` · ${h.changedBy}`}
                                  </span>
                                  {h.note && <span className={styles.historyNote}>{h.note.replace(/\s*via\s+\S+/gi, '')}</span>}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Boutons d'action — une seule ligne */}
                      <div className={styles.statusButtons}>
                        {isReadable(request.filePath) && (
                          <button
                            className={`${styles.aIconBtn} ${styles.aIconBtnSuccess}`}
                            title="Lire"
                            onClick={() => setReaderRequest({ title: request.title, requestId: { _id: request._id, filePath: request.filePath, downloadLink: request.downloadLink } })}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
                            </svg>
                          </button>
                        )}
                        {(request.downloadLink || request.filePath) && (
                          <button
                            className={`${styles.aIconBtn} ${styles.aIconBtnPrimary}`}
                            title="Télécharger"
                            onClick={() => setDownloadModalRequest(request)}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                          </button>
                        )}
                        {(request.downloadLink || request.filePath) && (
                          <button className={styles.aIconBtn} title="Copier le lien"
                            onClick={() => {
                              const link = request.filePath ? `${window.location.origin}/api/requests/download/${request._id}` : request.downloadLink;
                              navigator.clipboard.writeText(link); toast.success('Lien copié');
                            }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                          </button>
                        )}
                        {(request.downloadLink || request.filePath) && (
                          <button className={styles.aIconBtn} title="Remplacer le fichier"
                            onClick={() => { setEditingDownloadLink(request._id); setDownloadLink(request.downloadLink || ''); setFile(null); }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="12 18 12 12"/><polyline points="9 15 12 12 15 15"/></svg>
                          </button>
                        )}
                        <button className={styles.aIconBtn} title="Chercher sur PreDB"
                          onClick={() => handlePredbCheck(request)} disabled={checkingPredb.has(request._id)}>
                          {checkingPredb.has(request._id) ? <span className={styles.spinner}/> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>}
                        </button>
                        {request.status === 'pending' && (
                          <button className={`${styles.aIconBtn} ${styles.aIconBtnValentine}`}
                            title="Rechercher sur les connecteurs"
                            onClick={() => openConnectorsModal(request)}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
                            </svg>
                          </button>
                        )}
                        <button className={styles.aIconBtn} title={request.adminComment ? 'Modifier la note admin' : 'Ajouter une note admin'}
                          onClick={() => { setCommentModal(request._id); setCommentValue(request.adminComment || ''); }}>
                          {request.adminComment
                            ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                          }
                        </button>
                        <span className={styles.btnDivider}/>
                        {request.status === 'pending' && (<>
                          <button className={`${styles.aIconBtn} ${styles.aIconBtnPrimary}`} title="Ajouter le fichier"
                            onClick={() => { setEditingDownloadLink(request._id); setDownloadLink(request.downloadLink || ''); setFile(null); }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                          </button>
                          <button className={`${styles.aIconBtn} ${styles.aIconBtnDanger}`} title="Annuler la demande"
                            onClick={() => setCancelingRequest(request._id)} disabled={updatingStatus === request._id}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          </button>
                        </>)}
                        {request.status === 'reported' && (<>
                          <button className={`${styles.aIconBtn} ${styles.aIconBtnPrimary}`} title="Résolu — Compléter"
                            onClick={() => handleUpdateStatus(request._id, 'completed')} disabled={updatingStatus === request._id}>
                            {updatingStatus === request._id ? <span className={styles.spinner}/> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                          </button>
                          <button className={`${styles.aIconBtn} ${styles.aIconBtnWarning}`} title="Repasser en attente"
                            onClick={() => handleUpdateStatus(request._id, 'pending')} disabled={updatingStatus === request._id}>
                            {updatingStatus === request._id ? <span className={styles.spinner}/> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.54"/></svg>}
                          </button>
                          <button className={styles.aIconBtn} title="Remplacer le fichier"
                            onClick={() => { setEditingDownloadLink(request._id); setDownloadLink(request.downloadLink || ''); setFile(null); }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="12 18 12 12"/><polyline points="9 15 12 12 15 15"/></svg>
                          </button>
                        </>)}
                        {(request.status === 'completed' || request.status === 'canceled') && (<>
                          <button className={`${styles.aIconBtn} ${styles.aIconBtnWarning}`} title="Repasser en attente"
                            onClick={() => handleUpdateStatus(request._id, 'pending')} disabled={updatingStatus === request._id}>
                            {updatingStatus === request._id ? <span className={styles.spinner}/> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>}
                          </button>
                          {request.status === 'completed' && (
                            <button className={`${styles.aIconBtn} ${styles.aIconBtnDanger}`} title="Annuler la demande"
                              onClick={() => { setCancelingRequest(request._id); setCancelReason(''); }} disabled={updatingStatus === request._id}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            </button>
                          )}
                          {request.status === 'canceled' && (
                            <button className={`${styles.aIconBtn} ${styles.aIconBtnPrimary}`} title="Réactiver"
                              onClick={() => handleUpdateStatus(request._id, 'pending')} disabled={updatingStatus === request._id}>
                              {updatingStatus === request._id ? <span className={styles.spinner}/> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.54"/></svg>}
                            </button>
                          )}
                        </>)}
                        <button className={`${styles.aIconBtn} ${styles.aIconBtnDanger}`} title="Supprimer la demande"
                          onClick={() => handleDeleteRequest(request._id)} disabled={deletingRequest === request._id}>
                          {deletingRequest === request._id ? <span className={styles.spinner}/> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>}
                        </button>
                      </div>

                      {cancelingRequest === request._id && (
                      <div className={styles.cancelForm}>
                        <input
                          type="text"
                          value={cancelReason}
                          onChange={(e) => setCancelReason(e.target.value)}
                          placeholder="Raison de l'annulation"
                          className={styles.cancelInput}
                          autoFocus
                        />
                        <div className={styles.cancelButtons}>
                          <button 
                            className={`${styles.button} ${styles.primary}`}
                            onClick={() => handleCancelRequest(request._id)}
                            disabled={updatingStatus === request._id}
                          >
                            {updatingStatus === request._id ? '...' : 'Confirmer'}
                          </button>
                          <button 
                            className={styles.button}
                            onClick={() => {
                              setCancelingRequest(null);
                              setCancelReason('');
                            }}
                          >
                            Annuler
                          </button>
                        </div>
                      </div>
                    )}
                    
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          </div>
        )}
        {!loading && filtered.length > ITEMS_PER_PAGE && (
          <div className={styles.pagination}>
            <button
              className={styles.pageButton}
              onClick={() => setCurrentPage(p => Math.max(p - 1, 1))}
              disabled={currentPage === 1}
            >
              <span className={styles.btnLabel}>← Précédent</span><span className={styles.btnIcon}>←</span>
            </button>
            <span className={styles.pageInfo}>
              Page {currentPage} / {totalPages} — {requests.length} demande{requests.length > 1 ? 's' : ''}
            </span>
            <button
              className={styles.pageButton}
              onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))}
              disabled={currentPage === totalPages}
            >
              <span className={styles.btnLabel}>Suivant →</span><span className={styles.btnIcon}>→</span>
            </button>
          </div>
        )}
      </div>
    );
  };

  const NAV_ITEMS = [
    {
      id: 'requests',
      label: 'Demandes',
      icon: (
        <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
          <rect x="9" y="3" width="6" height="4" rx="1"/>
          <path d="M9 12h6M9 16h4"/>
        </svg>
      )
    },
    {
      id: 'users',
      label: 'Utilisateurs',
      icon: (
        <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
      )
    },
    {
      id: 'invitations',
      label: 'Invitations',
      icon: (
        <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <line x1="19" y1="8" x2="19" y2="14"/>
          <line x1="22" y1="11" x2="16" y2="11"/>
        </svg>
      )
    },
    {
      id: 'stats',
      label: 'Statistiques',
      icon: (
        <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="20" x2="18" y2="10"/>
          <line x1="12" y1="20" x2="12" y2="4"/>
          <line x1="6" y1="20" x2="6" y2="14"/>
        </svg>
      )
    },
    {
      id: 'health',
      label: 'Services',
      icon: (
        <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
      )
    },
    {
      id: 'connectors',
      label: 'Connecteurs',
      icon: (
        <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8H6a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2z"/>
        </svg>
      )
    },
    {
      id: 'pushover',
      label: 'Notifications',
      icon: (
        <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
      )
    },
    {
      id: 'broadcast',
      label: 'Diffusion',
      icon: (
        <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <line x1="22" y1="2" x2="11" y2="13"/>
          <polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
      )
    },
    {
      id: 'emails',
      label: 'Emails',
      icon: (
        <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
          <polyline points="22,6 12,13 2,6"/>
        </svg>
      )
    },
    {
      id: 'bestsellers',
      label: 'Bestsellers',
      icon: (
        <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
      )
    },
    {
      id: 'opds',
      label: 'OPDS',
      icon: (
        <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
        </svg>
      )
    },
    {
      id: 'logs',
      label: 'Logs',
      icon: (
        <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10 9 9 9 8 9"/>
        </svg>
      )
    },
    {
      id: 'updates',
      label: 'Mises à jour',
      icon: (
        <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <polyline points="23 4 23 10 17 10"/>
          <polyline points="1 20 1 14 7 14"/>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
        </svg>
      )
    },
  ];

  return (
    <div className={styles.adminContainer}>
      {previewBook && <BookPreviewModal book={previewBook} onClose={() => setPreviewBook(null)} />}

      {/* Modal upload / lien */}
      {editingDownloadLink && (() => {
        const req = requests.find(r => r._id === editingDownloadLink);
        const isReplace = !!(req?.filePath || req?.downloadLink);
        return (
          <div className={styles.uploadModalOverlay} onClick={(e) => {
            if (e.target === e.currentTarget && !uploadingFile) {
              setEditingDownloadLink(null); setFile(null); setDownloadLink(''); setShowFileBrowser(false); setUploadsSearch('');
            }
          }}>
            <div className={styles.uploadModal}>
              {/* Header */}
              <div className={styles.uploadModalHeader}>
                <div>
                  <h3 className={styles.uploadModalTitle}>
                    {isReplace ? 'Remplacer le fichier' : 'Ajouter un fichier'}
                  </h3>
                  {req && <p className={styles.uploadModalBook}>{req.title}</p>}
                </div>
                <button className={styles.uploadModalClose} onClick={() => { setEditingDownloadLink(null); setFile(null); setDownloadLink(''); setShowFileBrowser(false); setUploadsSearch(''); }} disabled={uploadingFile}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>

              {/* Body */}
              <div className={styles.uploadModalBody}>
                {/* Drop zone */}
                <label className={`${styles.dropZone} ${file ? styles.dropZoneActive : ''}`}>
                  <input
                    type="file"
                    onChange={handleFileChange}
                    accept=".pdf,.epub,.mobi,.azw,.azw3,.kfx,.cbz,.cbr,.cb7,.cbt,.cba,.djvu"
                    className={styles.fileInput}
                    disabled={uploadingFile}
                  />
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={styles.dropZoneIcon}>
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  {file ? (
                    <span className={styles.dropZoneFileName}>{file.name}</span>
                  ) : (
                    <>
                      <span className={styles.dropZoneText}>Glisser un fichier ici</span>
                      <span className={styles.dropZoneHint}>ou cliquer pour parcourir</span>
                    </>
                  )}
                  <span className={styles.dropZoneAccept}>PDF · EPUB · MOBI · AZW · DJVU · CBZ</span>
                </label>

                {/* Barre de progression */}
                {uploadingFile && (
                  <div className={styles.uploadProgressBar}>
                    <div className={styles.uploadProgressFill} style={{ width: `${uploadProgress}%` }}/>
                    <span className={styles.uploadProgressLabel}>{uploadProgress}%</span>
                  </div>
                )}

                {/* OU */}
                <div className={styles.orDivider}><span>OU</span></div>

                {/* Lien */}
                <input
                  type="text"
                  value={downloadLink}
                  placeholder="Coller un lien de téléchargement..."
                  onChange={(e) => { setDownloadLink(e.target.value); setFile(null); }}
                  className={styles.downloadLinkInput}
                  disabled={uploadingFile}
                />

                {/* OU */}
                <div className={styles.orDivider}><span>OU</span></div>

                {/* Fichiers existants */}
                <button
                  type="button"
                  className={styles.fileBrowserToggle}
                  onClick={() => {
                    const next = !showFileBrowser;
                    setShowFileBrowser(next);
                    if (next && uploadsList.length === 0) fetchUploadsList();
                  }}
                  disabled={uploadingFile}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '0.4rem', flexShrink: 0 }}>
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                  Sélectionner un fichier existant
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 'auto', transition: 'transform 0.2s', transform: showFileBrowser ? 'rotate(180deg)' : 'none' }}>
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>

                {showFileBrowser && (
                  <div className={styles.fileBrowserPanel}>
                    <input
                      type="text"
                      className={styles.fileBrowserSearch}
                      placeholder="Rechercher un fichier…"
                      value={uploadsSearch}
                      onChange={e => setUploadsSearch(e.target.value)}
                      autoFocus
                    />
                    <div className={styles.fileBrowserList}>
                      {uploadsLoading ? (
                        <div className={styles.fileBrowserEmpty}>Chargement…</div>
                      ) : uploadsList.length === 0 ? (
                        <div className={styles.fileBrowserEmpty}>Aucun fichier uploadé</div>
                      ) : (() => {
                        const filtered = uploadsList.filter(f =>
                          f.name.toLowerCase().includes(uploadsSearch.toLowerCase())
                        );
                        if (filtered.length === 0) return (
                          <div className={styles.fileBrowserEmpty}>Aucun fichier correspond à « {uploadsSearch} »</div>
                        );
                        return filtered.map(f => (
                          <button
                            key={f.filePath}
                            type="button"
                            className={styles.fileBrowserItem}
                            onClick={() => handleSelectExistingFile(editingDownloadLink, f.filePath)}
                            disabled={uploadingFile}
                            title={f.filePath}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.6 }}>
                              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
                              <polyline points="13 2 13 9 20 9"/>
                            </svg>
                            <span className={styles.fileBrowserName}>{f.name}</span>
                            <span className={styles.fileBrowserSize}>{(f.size / 1024 / 1024).toFixed(1)} Mo</span>
                          </button>
                        ));
                      })()}
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className={styles.uploadModalFooter}>
                <button
                  className={`${styles.button} ${styles.secondary}`}
                  onClick={() => { setEditingDownloadLink(null); setFile(null); setDownloadLink(''); setShowFileBrowser(false); setUploadsSearch(''); }}
                  disabled={uploadingFile}
                >
                  Annuler
                </button>
                <button
                  className={`${styles.button} ${styles.primary}`}
                  onClick={() => handleSaveDownloadLink(editingDownloadLink, downloadLink, file)}
                  disabled={(!downloadLink && !file) || uploadingFile}
                >
                  {uploadingFile ? (
                    <><span className={styles.spinner}/> {uploadProgress}%</>
                  ) : (
                    isReplace ? 'Remplacer' : 'Enregistrer'
                  )}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal commentaire admin */}
      {commentModal && (() => {
        const req = requests.find(r => r._id === commentModal);
        return (
          <div className={styles.uploadModalOverlay} onClick={(e) => {
            if (e.target === e.currentTarget) { setCommentModal(null); setCommentValue(''); }
          }}>
            <div className={styles.uploadModal}>
              <div className={styles.uploadModalHeader}>
                <div>
                  <h3 className={styles.uploadModalTitle}>
                    {req?.adminComment ? 'Modifier la note admin' : 'Ajouter une note admin'}
                  </h3>
                  {req && <p className={styles.uploadModalBook}>{req.title}</p>}
                </div>
                <button className={styles.uploadModalClose} onClick={() => { setCommentModal(null); setCommentValue(''); }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>

              <div className={styles.uploadModalBody}>
                {/* Note utilisateur en lecture seule si elle existe */}
                {req?.userComment && (
                  <div className={styles.commentModalUserNote}>
                    <span className={styles.commentModalUserNoteLabel}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                      Note utilisateur
                    </span>
                    <p className={styles.commentModalUserNoteText}>{req.userComment}</p>
                  </div>
                )}

                <textarea
                  value={commentValue}
                  onChange={(e) => setCommentValue(e.target.value)}
                  placeholder="Note visible par l'utilisateur…"
                  className={styles.commentModalTextarea}
                  rows="4"
                  autoFocus
                />
              </div>

              <div className={styles.uploadModalFooter}>
                <button className={`${styles.button} ${styles.secondary}`}
                  onClick={() => { setCommentModal(null); setCommentValue(''); }}>
                  Annuler
                </button>
                <button className={`${styles.button} ${styles.primary}`}
                  onClick={() => { handleSaveComment(commentModal); setCommentModal(null); }}>
                  Enregistrer
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal unifiée connecteurs (Valentine + Anna's Archive) */}
      {connectorsModal && (
        <div className={styles.uploadModalOverlay} onClick={e => { if (e.target === e.currentTarget) closeConnectorsModal(); }}>
          <div className={`${styles.uploadModal} ${styles.connectorsModal}`}>
            <div className={styles.uploadModalHeader}>
              <div>
                <h3 className={styles.uploadModalTitle}>Rechercher sur les connecteurs</h3>
                <p className={styles.uploadModalBook}>{connectorsModal.title}</p>
              </div>
              <button className={styles.uploadModalClose} onClick={closeConnectorsModal}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            <div className={styles.uploadModalBody}>
              <div className={styles.valentineSearchRow}>
                <input
                  className={styles.cancelInput}
                  style={{ flex: 1 }}
                  value={connectorsQuery}
                  onChange={e => setConnectorsQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !(valentineLoading || annasLoading) && runConnectorsSearch(connectorsQuery)}
                  placeholder="Titre à rechercher…"
                  autoFocus
                />
                <button
                  className={`${styles.aIconBtn} ${styles.aIconBtnValentine} ${styles.valentineSearchIconBtn}`}
                  onClick={() => runConnectorsSearch(connectorsQuery)}
                  disabled={valentineLoading || annasLoading}
                  title="Rechercher"
                >
                  {(valentineLoading || annasLoading)
                    ? <span className={styles.spinner} />
                    : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  }
                </button>
              </div>

              {(valentineResults !== null || annasResults !== null) && (
                <div className={styles.connectorsResultsGrid}>

                  <div className={styles.connectorsSection}>
                    <div className={styles.connectorsSectionHeader}>
                      <img src="https://valentine.wtf/logo.php?mode=clair" alt="Valentine" className={styles.connectorsSectionLogo} />
                      <span>Valentine.wtf</span>
                      {valentineLoading
                        ? <span className={styles.spinner} style={{ marginLeft: 'auto' }} />
                        : valentineModalQuota && !valentineModalQuota.error && (
                          <span className={styles.connectorQuotaInfo}>
                            <strong>{valentineModalQuota.remaining ?? '—'}</strong>
                            {valentineModalQuota.total != null && ` / ${valentineModalQuota.total}`}
                            {' '}restants
                          </span>
                        )
                      }
                    </div>
                    {valentineResults === null ? null : valentineResults.length === 0 ? (
                      <div className={styles.fileBrowserEmpty}>Aucun résultat</div>
                    ) : (
                      <div className={styles.valentineResultsList}>
                        {valentineResults.map(r => (
                          <div key={r.id} className={styles.valentineResultRow}>
                            {r.cover && <img src={r.cover} alt="" className={styles.valentineResultCover} />}
                            <div className={styles.valentineResultInfo}>
                              <span className={styles.valentineResultTitle}>{r.title}</span>
                              {r.author && <span className={styles.valentineResultAuthor}>{r.author}</span>}
                              {r.size && <span className={styles.valentineResultSize}>{r.size}</span>}
                            </div>
                            <div className={styles.valentineResultActions}>
                              {r.valentineUrl && (
                                <a href={r.valentineUrl} target="_blank" rel="noopener noreferrer"
                                  className={styles.aIconBtn} title="Voir sur Valentine" onClick={e => e.stopPropagation()}>
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                                </a>
                              )}
                              <button className={`${styles.aIconBtn} ${styles.aIconBtnSuccess}`}
                                disabled={valentineDownloading !== null}
                                onClick={() => downloadFromValentine(r.id)} title="Télécharger">
                                {valentineDownloading === r.id
                                  ? <span className={styles.spinner} />
                                  : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                }
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className={styles.connectorsSection}>
                    <div className={styles.connectorsSectionHeader}>
                      <span className={styles.connectorsSectionLogoAnnas}>A</span>
                      <span>Anna's Archive</span>
                      {annasLoading && <span className={styles.spinner} style={{marginLeft:'auto'}} />}
                    </div>
                    {annasResults === null ? null : annasResults.length === 0 ? (
                      <div className={styles.fileBrowserEmpty}>Aucun résultat</div>
                    ) : (
                      <div className={styles.valentineResultsList}>
                        {annasResults.map(r => (
                          <div key={r.md5} className={styles.valentineResultRow}>
                            {r.cover && <img src={r.cover} alt="" className={styles.valentineResultCover} referrerPolicy="no-referrer" />}
                            <div className={styles.valentineResultInfo}>
                              <span className={styles.valentineResultTitle}>{r.title}</span>
                              {r.author && <span className={styles.valentineResultAuthor}>{r.author}</span>}
                              <span className={styles.valentineResultSize}>{[r.format, r.size, r.year, r.lang].filter(Boolean).join(' · ')}</span>
                            </div>
                            <div className={styles.valentineResultActions}>
                              <a href={r.annaUrl} target="_blank" rel="noopener noreferrer"
                                className={styles.aIconBtn} title="Ouvrir sur Anna's Archive" onClick={e => e.stopPropagation()}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                              </a>
                              <button
                                className={`${styles.aIconBtn} ${styles.aIconBtnSuccess}`}
                                disabled={annasDownloading !== null}
                                onClick={() => downloadFromAnnasArchive(r.md5, r.format)}
                                title="Télécharger via Anna's Archive"
                              >
                                {annasDownloading === r.md5
                                  ? <span className={styles.spinner} />
                                  : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                }
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className={styles.adminLayout}>
        {/* Sidebar navigation — desktop */}
        <aside className={styles.adminSidebar}>
          <div className={styles.sidebarHeader}>
            <span className={styles.sidebarTitle}>Administration</span>
          </div>
          <nav className={styles.sidebarNav}>
            {NAV_ITEMS.map(item => (
              <button
                key={item.id}
                className={`${styles.sidebarItem} ${activeTab === item.id ? styles.sidebarItemActive : ''}`}
                onClick={() => setActiveTab(item.id)}
              >
                <span className={styles.sidebarIcon}>{item.icon}</span>
                <span className={styles.sidebarLabel}>{item.label}</span>
                {activeTab === item.id && <span className={styles.sidebarDot} />}
              </button>
            ))}
          </nav>
        </aside>

        {/* Dropdown navigation — mobile */}
        <div className={styles.mobileNav} ref={mobileNavRef}>
          <button
            className={styles.mobileNavTrigger}
            onClick={() => setMobileNavOpen(v => !v)}
          >
            <span className={styles.sidebarIcon}>
              {NAV_ITEMS.find(i => i.id === activeTab)?.icon}
            </span>
            <span className={styles.mobileNavCurrent}>
              {NAV_ITEMS.find(i => i.id === activeTab)?.label}
            </span>
            <svg
              className={`${styles.mobileNavChevron} ${mobileNavOpen ? styles.mobileNavChevronOpen : ''}`}
              width="16" height="16" fill="none" viewBox="0 0 24 24"
              stroke="currentColor" strokeWidth="2.5"
            >
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          {mobileNavOpen && (
            <div className={styles.mobileNavDropdown}>
              {NAV_ITEMS.map(item => (
                <button
                  key={item.id}
                  className={`${styles.mobileNavItem} ${activeTab === item.id ? styles.mobileNavItemActive : ''}`}
                  onClick={() => { setActiveTab(item.id); setMobileNavOpen(false); }}
                >
                  <span className={styles.sidebarIcon}>{item.icon}</span>
                  <span>{item.label}</span>
                  {activeTab === item.id && <span className={styles.sidebarDot} style={{marginLeft:'auto'}} />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Contenu principal */}
        <main className={styles.adminMain}>
          {renderTabContent()}
        </main>
      </div>

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
}

export default AdminPage;