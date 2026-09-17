import React, { useState, useEffect, useCallback } from 'react';
import axiosAdmin from '../axiosAdmin';
import { toast } from 'react-toastify';
import styles from './SendEmailModal.module.css';

const MailIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
    <polyline points="22 6 12 13 2 6"/>
  </svg>
);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * mode="user"  : choix entre "mon adresse" (résolue côté serveur, jamais
 *                envoyée en clair par le front) et une adresse libre.
 * mode="admin" : choix entre un utilisateur existant (chargé via
 *                GET /api/users, admin only) et une adresse libre.
 */
export default function SendEmailModal({ request, onClose, mode = 'user' }) {
  const [target, setTarget] = useState(mode === 'admin' ? 'user' : 'own');
  const [customEmail, setCustomEmail] = useState('');
  const [selectedUserEmail, setSelectedUserEmail] = useState('');
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(mode === 'admin');
  const [ownEmail, setOwnEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (mode !== 'admin') return;
    (async () => {
      try {
        const res = await axiosAdmin.get('/api/admin/users');
        const withEmail = (res.data || []).filter(u => u.email);
        setUsers(withEmail);
        if (withEmail.length > 0) setSelectedUserEmail(withEmail[0].email);
      } catch {
        setError('Impossible de charger la liste des utilisateurs.');
      } finally {
        setLoadingUsers(false);
      }
    })();
  }, [mode]);

  // Affichage uniquement : l'adresse envoyée au backend pour "mon adresse"
  // reste résolue côté serveur (useOwnEmail: true), jamais depuis ce state.
  useEffect(() => {
    if (mode !== 'user') return;
    (async () => {
      try {
        const res = await axiosAdmin.get('/api/users/me');
        if (res.data?.success) setOwnEmail(res.data.user?.email || '');
      } catch {
        // Pas bloquant : le radio reste utilisable, juste sans l'adresse affichée.
      }
    })();
  }, [mode]);

  const handleOverlayClick = (e) => { if (e.target === e.currentTarget) onClose(); };

  const handleSend = useCallback(async () => {
    setError('');

    let payload;
    if (mode === 'user' && target === 'own') {
      payload = { useOwnEmail: true };
    } else if (mode === 'admin' && target === 'user') {
      if (!selectedUserEmail) { setError('Aucun utilisateur sélectionné.'); return; }
      payload = { email: selectedUserEmail };
    } else {
      const trimmed = customEmail.trim();
      if (!EMAIL_RE.test(trimmed)) { setError('Adresse email invalide.'); return; }
      payload = { email: trimmed };
    }

    setSending(true);
    try {
      await axiosAdmin.post(`/api/requests/${request._id}/send-email`, payload);
      setSent(true);
      toast.success('Livre envoyé par email');
      setTimeout(onClose, 1200);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur lors de l\'envoi.');
    } finally {
      setSending(false);
    }
  }, [mode, target, selectedUserEmail, customEmail, request._id, onClose]);

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <div className={styles.title}>
            <MailIcon />
            <span>Envoyer par email</span>
          </div>
          <button className={styles.closeBtn} onClick={onClose} title="Fermer">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className={styles.body}>
          <p className={styles.bookTitle}>{request.title}</p>
          {request.author && <p className={styles.bookAuthor}>{request.author}</p>}

          {error && (
            <div className={styles.errorMsg}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              {error}
            </div>
          )}

          <div className={styles.optionsGroup}>
            {mode === 'user' && (
              <label className={styles.radioRow}>
                <input type="radio" name="emailTarget" checked={target === 'own'} onChange={() => setTarget('own')} disabled={sending} />
                <span>Mon adresse email{ownEmail && <span className={styles.radioHint}> ({ownEmail})</span>}</span>
              </label>
            )}

            {mode === 'admin' && (
              <label className={styles.radioRow}>
                <input type="radio" name="emailTarget" checked={target === 'user'} onChange={() => setTarget('user')} disabled={sending || loadingUsers} />
                <span>Un utilisateur</span>
              </label>
            )}
            {mode === 'admin' && target === 'user' && (
              <select
                className={styles.select}
                value={selectedUserEmail}
                onChange={e => setSelectedUserEmail(e.target.value)}
                disabled={sending || loadingUsers}
              >
                {loadingUsers && <option>Chargement…</option>}
                {!loadingUsers && users.length === 0 && <option>Aucun utilisateur avec email</option>}
                {users.map(u => (
                  <option key={u._id} value={u.email}>{u.username} — {u.email}</option>
                ))}
              </select>
            )}

            <label className={styles.radioRow}>
              <input type="radio" name="emailTarget" checked={target === 'other'} onChange={() => setTarget('other')} disabled={sending} />
              <span>Autre adresse</span>
            </label>
            {target === 'other' && (
              <input
                type="email"
                className={styles.textInput}
                placeholder="adresse@exemple.fr"
                value={customEmail}
                onChange={e => setCustomEmail(e.target.value)}
                disabled={sending}
                autoFocus
              />
            )}
          </div>

          <button className={styles.sendBtn} onClick={handleSend} disabled={sending || sent}>
            {sending
              ? <><span className={styles.spinner} /> Envoi…</>
              : sent
                ? <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Envoyé</>
                : <><MailIcon /> Envoyer</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}
