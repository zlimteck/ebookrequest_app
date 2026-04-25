import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axiosAdmin from '../../axiosAdmin';
import { toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import styles from './UserDashboard.module.css';
import BookPreviewModal from '../../components/BookPreviewModal';


const UserDashboard = () => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const filterBarRef = useRef(null);
  const filterScrollRestore = useRef(null);
  const navigate = useNavigate();
  const [downloadingFile, setDownloadingFile] = useState(null);
  const [reportModal, setReportModal] = useState({ isOpen: false, requestId: null, requestTitle: '' });
  const [reportReason, setReportReason] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 6;
  const [previewBook, setPreviewBook] = useState(null);
  const [search, setSearch] = useState('');
  const [commentModal, setCommentModal] = useState(null); // request._id pour le modal note
  const [commentValue, setCommentValue] = useState('');
  const [expandedHistory, setExpandedHistory] = useState(null);
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
  

  // Vérifier les mises à jour toutes les 60 secondes
  useEffect(() => {
    const intervalId = setInterval(fetchRequests, 60000);
    return () => clearInterval(intervalId);
  }, [filter]);

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

  const filteredRequests = requests.filter(r => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return r.title?.toLowerCase().includes(q) || r.author?.toLowerCase().includes(q);
  });

  return (
    <div className={styles.dashboardContainer}>
      {previewBook && <BookPreviewModal book={previewBook} onClose={() => setPreviewBook(null)} />}

      {/* Modal note utilisateur */}
      {commentModal && (() => {
        const req = requests.find(r => r._id === commentModal);
        return (
          <div className={styles.noteModalOverlay} onClick={(e) => {
            if (e.target === e.currentTarget) { setCommentModal(null); setCommentValue(''); }
          }}>
            <div className={styles.noteModal}>
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
          placeholder="Rechercher par titre ou auteur…"
          value={search}
          onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
          className={styles.searchInput}
        />
        {search && (
          <button className={styles.searchClear} onClick={() => { setSearch(''); setCurrentPage(1); }}>×</button>
        )}
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
        <div className={styles.requestsGrid}>
          {filteredRequests.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE).map((request) => (
            <div key={request._id} className={`${styles.requestCard} ${
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
                </div>

                <p className={styles.requestAuthor}>
                  {request.author}
                </p>

                {/* Meta: format + pages */}
                {(request.format || request.pageCount > 0) && (
                  <div className={styles.metaRow}>
                    {request.format && (
                      <span className={styles.formatBadge}>{request.format.toUpperCase()}</span>
                    )}
                    {request.pageCount > 0 && (
                      <span className={styles.pagesBadge}>{request.pageCount} pages</span>
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
                                  {new Date(h.changedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
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
                        <button
                          className={`${styles.iconBtn} ${styles.iconBtnPrimary} ${downloadingFile === request._id ? styles.downloading : ''}`}
                          onClick={async (e) => {
                            e.preventDefault();
                            try { await downloadFile(request); }
                            catch (error) { toast.error('Une erreur est survenue lors du téléchargement'); }
                          }}
                          disabled={downloadingFile === request._id}
                          title={downloadingFile === request._id ? 'Téléchargement...' : request.downloadedAt ? `Téléchargé le ${new Date(request.downloadedAt).toLocaleDateString('fr-FR')}` : `Télécharger ${request.filePath ? `(${getFileType(request.filePath)})` : ''}`}
                        >
                          {downloadingFile === request._id ? <span className={styles.spinner} /> : (
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                              <polyline points="7 10 12 15 17 10"/>
                              <line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                          )}
                        </button>
                        <button className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={() => setReportModal({ isOpen: true, requestId: request._id, requestTitle: request.title })} title="Signaler un problème">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
                            <line x1="4" y1="22" x2="4" y2="15"/>
                          </svg>
                        </button>
                      </>
                    )}

                    {true && (
                      <button className={`${styles.iconBtn} ${styles.iconBtnNote}`} onClick={() => { setCommentModal(request._id); setCommentValue(request.userComment || ''); }} title={request.userComment ? 'Modifier la note' : 'Ajouter une note'}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          {request.userComment ? (
                            <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></>
                          ) : (
                            <><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></>
                          )}
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

      {/* Modal de signalement */}
      {reportModal.isOpen && (
        <div className={styles.modalOverlay} onClick={() => {
          setReportModal({ isOpen: false, requestId: null, requestTitle: '' });
          setReportReason('');
        }}>
          <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
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
    </div>
  );
};

export default UserDashboard;