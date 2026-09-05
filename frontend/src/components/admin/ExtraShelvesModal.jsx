import React, { useState, useEffect } from 'react';
import axiosAdmin from '../../axiosAdmin';
import styles from './ExtraShelvesModal.module.css';

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const ShelfIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v18h18" /><path d="M3 8h18" /><path d="M3 13h18" /><path d="M3 18h18" />
  </svg>
);

const STATUS_LABELS = { success: 'Envoyé', partial: 'Partiel', failed: 'Échec' };

/**
 * Modale admin — pousse un livre déjà complété vers les étagères Calibre-Web
 * de plusieurs autres utilisateurs à la fois (multishelf multi-utilisateurs).
 * N'effectue pas de ré-upload : réutilise le calibreBookId déjà connu de la
 * demande (celui du propriétaire), ou le retrouve via un des comptes ciblés.
 */
export default function ExtraShelvesModal({ request, onClose, onUpdated }) {
  const [candidates, setCandidates] = useState([]); // [{ _id, username, shelves: [{name,isDefault}] }]
  const [selections, setSelections] = useState({}); // { [userId]: [shelfName, ...] }
  const [statuses, setStatuses] = useState({}); // { [userId]: { status, error } } — état après un envoi
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await axiosAdmin.get('/api/requests/calibre/shelf-targets');
        if (cancelled) return;
        const all = Array.isArray(res.data) ? res.data : [];
        // Exclut le propriétaire de la demande : son propre push est géré
        // séparément (flux self-service classique), pas par cette modale.
        const filtered = all.filter(u => u.username !== request.username);
        setCandidates(filtered);

        // Pré-coche les cibles déjà connues sur la demande.
        const previous = {};
        const prevStatuses = {};
        (request.extraShelfTargets || []).forEach(t => {
          const uid = typeof t.user === 'string' ? t.user : t.user?._id || t.user;
          if (!uid) return;
          previous[uid] = t.shelves || [];
          if (t.status) prevStatuses[uid] = { status: t.status, error: t.error };
        });
        setSelections(previous);
        setStatuses(prevStatuses);
      } catch {
        if (!cancelled) setError('Impossible de charger la liste des comptes Calibre-Web.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [request.username, request.extraShelfTargets]);

  const toggleShelf = (userId, shelfName) => {
    setSelections(prev => {
      const current = prev[userId] || [];
      const next = current.includes(shelfName)
        ? current.filter(s => s !== shelfName)
        : [...current, shelfName];
      return { ...prev, [userId]: next };
    });
  };

  const handleSubmit = async () => {
    // On envoie une cible même à shelves vides si elle avait une sélection
    // précédente, pour que le backend puisse retirer via reconciliation.
    const targets = candidates
      .map(u => ({ userId: u._id, shelves: selections[u._id] || [] }))
      .filter(t => t.shelves.length > 0 || (request.extraShelfTargets || []).some(e => {
        const uid = typeof e.user === 'string' ? e.user : e.user?._id || e.user;
        return uid === t.userId;
      }));

    if (!targets.length) {
      setError('Choisissez au moins une étagère pour au moins un utilisateur.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const res = await axiosAdmin.post(`/api/requests/${request._id}/extra-shelves`, { targets });
      const newStatuses = {};
      (res.data?.results || []).forEach(r => {
        newStatuses[r.userId] = { status: r.status, error: r.error || null };
      });
      setStatuses(newStatuses);
      onUpdated?.(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de l\'envoi vers les étagères additionnelles.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.title}><ShelfIcon /> Étagères additionnelles</div>
          <button className={styles.closeBtn} onClick={onClose} title="Fermer"><CloseIcon /></button>
        </div>

        <div className={styles.body}>
          <div>
            <p className={styles.bookTitle}>{request.title}</p>
            {request.author && <p className={styles.bookAuthor}>{request.author}</p>}
          </div>

          {error && <div className={styles.errorMsg}>{error}</div>}

          {loading ? (
            <p className={styles.emptyMsg}>Chargement…</p>
          ) : candidates.length === 0 ? (
            <p className={styles.emptyMsg}>Aucun autre compte Calibre-Web configuré.</p>
          ) : (
            candidates.map(u => {
              const st = statuses[u._id];
              return (
                <div key={u._id} className={styles.userSection}>
                  <div className={styles.userHeader}>
                    <span className={styles.userName}>{u.username}</span>
                    {st?.status && (
                      <span
                        className={`${styles.statusBadge} ${
                          st.status === 'success' ? styles.statusSuccess
                          : st.status === 'partial' ? styles.statusPartial
                          : styles.statusFailed
                        }`}
                        title={st.error || ''}
                      >
                        {STATUS_LABELS[st.status] || st.status}
                      </span>
                    )}
                  </div>
                  {(u.shelves || []).length === 0 ? (
                    <span className={styles.noShelves}>Aucune étagère configurée pour cet utilisateur</span>
                  ) : (
                    u.shelves.map(s => (
                      <label key={s.name} className={styles.shelfLabel}>
                        <input
                          type="checkbox"
                          checked={(selections[u._id] || []).includes(s.name)}
                          onChange={() => toggleShelf(u._id, s.name)}
                        />
                        {s.name}
                      </label>
                    ))
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose}>Fermer</button>
          {candidates.length > 0 && (
            <button className={styles.submitBtn} onClick={handleSubmit} disabled={submitting || loading}>
              {submitting ? 'Envoi…' : 'Envoyer'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
