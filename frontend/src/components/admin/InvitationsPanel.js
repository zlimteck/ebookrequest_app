import React, { useEffect, useState } from 'react';
import axiosAdmin from '../../axiosAdmin';
import styles from './InvitationsPanel.module.css';

const STATUS_LABELS = {
  pending:  { label: 'En attente', cls: 'pending' },
  accepted: { label: 'Acceptée',   cls: 'accepted' },
  expired:  { label: 'Expirée',    cls: 'expired' },
  canceled: { label: 'Annulée',    cls: 'canceled' },
};

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function InvitationsPanel() {
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [sendOk, setSendOk] = useState('');
  const [resending, setResending] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const fetchInvitations = async () => {
    try {
      const res = await axiosAdmin.get('/api/invitations');
      setInvitations(res.data.invitations);
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => { fetchInvitations(); }, []);

  const handleSend = async (e) => {
    e.preventDefault();
    setSendError('');
    setSendOk('');
    if (!email.trim()) return;
    setSending(true);
    try {
      await axiosAdmin.post('/api/invitations', { email: email.trim() });
      setSendOk(`Invitation envoyée à ${email.trim()}`);
      setEmail('');
      fetchInvitations();
    } catch (err) {
      setSendError(err.response?.data?.error || 'Erreur lors de l\'envoi.');
    } finally {
      setSending(false);
      setTimeout(() => { setSendOk(''); setSendError(''); }, 5000);
    }
  };

  const handleResend = async (id) => {
    setResending(id);
    try {
      await axiosAdmin.post(`/api/invitations/${id}/resend`);
      fetchInvitations();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur lors du renvoi.');
    } finally {
      setResending(null);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Supprimer cette invitation ?')) return;
    setDeleting(id);
    try {
      await axiosAdmin.delete(`/api/invitations/${id}`);
      setInvitations(prev => prev.filter(i => i._id !== id));
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur lors de la suppression.');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className={styles.panel}>
      {/* Header */}
      <div className={styles.panelHeader}>
        <h2 className={styles.panelTitle}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <line x1="19" y1="8" x2="19" y2="14"/>
            <line x1="22" y1="11" x2="16" y2="11"/>
          </svg>
          Invitations
        </h2>
        <p className={styles.panelSubtitle}>Invitez des utilisateurs à rejoindre la plateforme par email.</p>
      </div>

      {/* Formulaire d'envoi */}
      <div className={styles.sendCard}>
        <form className={styles.sendForm} onSubmit={handleSend}>
          <div className={styles.sendInputWrap}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.sendIcon}>
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
              <polyline points="22,6 12,13 2,6"/>
            </svg>
            <input
              className={styles.sendInput}
              type="email"
              placeholder="email@exemple.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
          </div>
          <button className={styles.sendBtn} type="submit" disabled={sending}>
            {sending ? 'Envoi…' : 'Envoyer l\'invitation'}
          </button>
        </form>
        {sendOk    && <p className={styles.sendOk}>{sendOk}</p>}
        {sendError && <p className={styles.sendErr}>{sendError}</p>}
      </div>

      {/* Tableau des invitations */}
      <div className={styles.tableWrap}>
        {loading ? (
          <div className={styles.loadingRow}><div className={styles.spinner}/></div>
        ) : invitations.length === 0 ? (
          <div className={styles.emptyRow}>Aucune invitation envoyée pour l'instant.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Email</th>
                <th>Statut</th>
                <th>Envoyée le</th>
                <th>Expire le</th>
                <th>Invité par</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {invitations.map(inv => {
                const st = STATUS_LABELS[inv.status] || { label: inv.status, cls: 'pending' };
                return (
                  <tr key={inv._id}>
                    <td className={styles.emailCell}>{inv.email}</td>
                    <td><span className={`${styles.badge} ${styles[st.cls]}`}>{st.label}</span></td>
                    <td className={styles.dateCell}>{fmtDate(inv.createdAt)}</td>
                    <td className={styles.dateCell}>{inv.status === 'accepted' ? fmtDate(inv.acceptedAt) : fmtDate(inv.expiresAt)}</td>
                    <td className={styles.byCell}>{inv.invitedByUsername || '—'}</td>
                    <td className={styles.actionsCell}>
                      {inv.status !== 'accepted' && (
                        <button
                          className={styles.actionBtn}
                          onClick={() => handleResend(inv._id)}
                          disabled={resending === inv._id}
                          title="Renvoyer"
                        >
                          {resending === inv._id ? '…' : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="23 4 23 10 17 10"/>
                              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                            </svg>
                          )}
                        </button>
                      )}
                      <button
                        className={`${styles.actionBtn} ${styles.deleteBtn}`}
                        onClick={() => handleDelete(inv._id)}
                        disabled={deleting === inv._id}
                        title="Supprimer"
                      >
                        {deleting === inv._id ? '…' : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                            <path d="M10 11v6M14 11v6"/>
                            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                          </svg>
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}