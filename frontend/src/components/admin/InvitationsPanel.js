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

// ── Onglet Email ──────────────────────────────────────────────────────────────
function EmailTab() {
  const [invitations, setInvitations] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [email, setEmail]             = useState('');
  const [sending, setSending]         = useState(false);
  const [sendError, setSendError]     = useState('');
  const [sendOk, setSendOk]           = useState('');
  const [resending, setResending]     = useState(null);
  const [deleting, setDeleting]       = useState(null);

  const fetchInvitations = async () => {
    try {
      const res = await axiosAdmin.get('/api/invitations');
      setInvitations(res.data.invitations);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { fetchInvitations(); }, []);

  const handleSend = async (e) => {
    e.preventDefault();
    setSendError(''); setSendOk('');
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
    } finally { setResending(null); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Supprimer cette invitation ?')) return;
    setDeleting(id);
    try {
      await axiosAdmin.delete(`/api/invitations/${id}`);
      setInvitations(prev => prev.filter(i => i._id !== id));
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur lors de la suppression.');
    } finally { setDeleting(null); }
  };

  return (
    <>
      <div className={styles.sendCard}>
        <form className={styles.sendForm} onSubmit={handleSend}>
          <div className={styles.sendInputWrap}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.sendIcon}>
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
              <polyline points="22,6 12,13 2,6"/>
            </svg>
            <input className={styles.sendInput} type="email" placeholder="email@exemple.com"
              value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <button className={styles.sendBtn} type="submit" disabled={sending}>
            {sending ? 'Envoi…' : 'Envoyer l\'invitation'}
          </button>
        </form>
        {sendOk    && <p className={styles.sendOk}>{sendOk}</p>}
        {sendError && <p className={styles.sendErr}>{sendError}</p>}
      </div>

      <div className={styles.tableWrap}>
        {loading ? (
          <div className={styles.loadingRow}><div className={styles.spinner}/></div>
        ) : invitations.length === 0 ? (
          <div className={styles.emptyRow}>Aucune invitation envoyée pour l'instant.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Email</th><th>Statut</th><th>Envoyée le</th><th>Expire le</th><th>Invité par</th><th></th>
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
                        <button className={styles.actionBtn} onClick={() => handleResend(inv._id)}
                          disabled={resending === inv._id} title="Renvoyer">
                          {resending === inv._id ? '…' : (
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="23 4 23 10 17 10"/>
                              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                            </svg>
                          )}
                        </button>
                      )}
                      <button className={`${styles.actionBtn} ${styles.deleteBtn}`}
                        onClick={() => handleDelete(inv._id)} disabled={deleting === inv._id} title="Supprimer">
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
    </>
  );
}

// ── Onglet Codes ──────────────────────────────────────────────────────────────
const EXPIRY_PRESETS = [
  { label: 'Jamais',    value: null },
  { label: '24 h',      value: 24 * 60 * 60 * 1000 },
  { label: '48 h',      value: 48 * 60 * 60 * 1000 },
  { label: '72 h',      value: 72 * 60 * 60 * 1000 },
  { label: '1 semaine', value: 7  * 24 * 60 * 60 * 1000 },
  { label: '1 mois',    value: 30 * 24 * 60 * 60 * 1000 },
  { label: '1 an',      value: 365 * 24 * 60 * 60 * 1000 },
];

function CodesTab() {
  const [codes, setCodes]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [maxUses, setMaxUses]       = useState(1);
  const [expiryPreset, setExpiryPreset] = useState(null); // null = jamais
  const [creating, setCreating]     = useState(false);
  const [createMsg, setCreateMsg]   = useState({ text: '', type: '' });
  const [toggling, setToggling]   = useState(null);
  const [deleting, setDeleting]   = useState(null);
  const [expanded, setExpanded]   = useState(null); // id du code dont on affiche les users
  const [copied, setCopied]       = useState(null);

  const fetchCodes = async () => {
    try {
      const res = await axiosAdmin.get('/api/invitation-codes');
      setCodes(res.data.codes || []);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { fetchCodes(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreateMsg({ text: '', type: '' });
    setCreating(true);
    try {
      const payload = { maxUses: parseInt(maxUses, 10) || 1 };
      if (expiryPreset !== null) payload.expiresAt = new Date(Date.now() + expiryPreset).toISOString();
      const res = await axiosAdmin.post('/api/invitation-codes', payload);
      setCreateMsg({ text: `Code créé : ${res.data.invitationCode.code}`, type: 'ok' });
      setMaxUses(1);
      setExpiryPreset(null);
      fetchCodes();
    } catch (err) {
      setCreateMsg({ text: err.response?.data?.error || 'Erreur lors de la création.', type: 'err' });
    } finally {
      setCreating(false);
      setTimeout(() => setCreateMsg({ text: '', type: '' }), 6000);
    }
  };

  const handleToggle = async (id) => {
    setToggling(id);
    try {
      const res = await axiosAdmin.patch(`/api/invitation-codes/${id}/toggle`);
      setCodes(prev => prev.map(c => c._id === id ? { ...c, isActive: res.data.isActive } : c));
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur.');
    } finally { setToggling(null); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Supprimer ce code d\'invitation ?')) return;
    setDeleting(id);
    try {
      await axiosAdmin.delete(`/api/invitation-codes/${id}`);
      setCodes(prev => prev.filter(c => c._id !== id));
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur lors de la suppression.');
    } finally { setDeleting(null); }
  };

  const handleCopy = (code, id) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const isExpired = (c) => c.expiresAt && new Date(c.expiresAt) < new Date();
  const isExhausted = (c) => c.maxUses > 0 && c.usedCount >= c.maxUses;

  return (
    <>
      {/* Formulaire de création */}
      <div className={styles.sendCard}>
        <form className={styles.codeCreateForm} onSubmit={handleCreate}>
          <div className={styles.codeCreateRow}>
            {/* Nombre d'utilisations */}
            <div className={styles.codeCreateFieldSmall}>
              <label className={styles.codeCreateLabel}>Utilisations <span style={{ opacity: 0.5 }}>(0 = ∞)</span></label>
              <input
                className={styles.sendInput}
                type="number"
                min="0"
                value={maxUses}
                onChange={e => setMaxUses(e.target.value)}
                style={{ width: '100%' }}
              />
            </div>
            {/* Expiration — select preset */}
            <div className={styles.codeCreateFieldGrow}>
              <label className={styles.codeCreateLabel}>Expiration</label>
              <select
                className={styles.sendInput}
                value={expiryPreset === null ? '' : String(expiryPreset)}
                onChange={e => setExpiryPreset(e.target.value === '' ? null : Number(e.target.value))}
                style={{ width: '100%' }}
              >
                {EXPIRY_PRESETS.map(p => (
                  <option key={p.label} value={p.value === null ? '' : String(p.value)}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <button className={styles.sendBtn} type="submit" disabled={creating} style={{ alignSelf: 'flex-end', whiteSpace: 'nowrap' }}>
              {creating ? 'Génération…' : 'Générer un code'}
            </button>
          </div>
        </form>
        {createMsg.text && (
          <p className={createMsg.type === 'ok' ? styles.sendOk : styles.sendErr}>{createMsg.text}</p>
        )}
      </div>

      {/* Liste des codes */}
      <div className={styles.tableWrap}>
        {loading ? (
          <div className={styles.loadingRow}><div className={styles.spinner}/></div>
        ) : codes.length === 0 ? (
          <div className={styles.emptyRow}>Aucun code d'invitation créé pour l'instant.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Code</th>
                <th>Utilisations</th>
                <th>Expiration</th>
                <th>Statut</th>
                <th>Créé par</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {codes.map(c => {
                const expired   = isExpired(c);
                const exhausted = isExhausted(c);
                const inactive  = !c.isActive || expired || exhausted;
                return (
                  <React.Fragment key={c._id}>
                    <tr>
                      {/* Code + bouton copier */}
                      <td>
                        <div className={styles.codeCell}>
                          <span className={styles.codeValue}>{c.code}</span>
                          <button
                            className={styles.copyBtn}
                            type="button"
                            onClick={() => handleCopy(c.code, c._id)}
                            title="Copier"
                          >
                            {copied === c._id ? (
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20 6 9 17l-5-5"/>
                              </svg>
                            ) : (
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                              </svg>
                            )}
                          </button>
                        </div>
                      </td>

                      {/* Utilisations */}
                      <td>
                        <button
                          className={styles.usageBtn}
                          type="button"
                          onClick={() => setExpanded(expanded === c._id ? null : c._id)}
                          title={c.usedBy?.length ? 'Voir les utilisateurs' : undefined}
                          disabled={!c.usedBy?.length}
                        >
                          <span className={exhausted ? styles.usageExhausted : styles.usageOk}>
                            {c.usedCount} / {c.maxUses === 0 ? '∞' : c.maxUses}
                          </span>
                          {c.usedBy?.length > 0 && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                              style={{ marginLeft: '0.3rem', transform: expanded === c._id ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                              <path d="m6 9 6 6 6-6"/>
                            </svg>
                          )}
                        </button>
                      </td>

                      {/* Expiration */}
                      <td className={styles.dateCell}>
                        {c.expiresAt ? (
                          <span style={{ color: expired ? '#ef4444' : 'inherit' }}>{fmtDate(c.expiresAt)}</span>
                        ) : '—'}
                      </td>

                      {/* Statut */}
                      <td>
                        {expired   ? <span className={`${styles.badge} ${styles.expired}`}>Expiré</span>
                        : exhausted ? <span className={`${styles.badge} ${styles.expired}`}>Épuisé</span>
                        : c.isActive ? <span className={`${styles.badge} ${styles.accepted}`}>Actif</span>
                        :              <span className={`${styles.badge} ${styles.canceled}`}>Désactivé</span>}
                      </td>

                      {/* Créé par */}
                      <td className={styles.byCell}>{c.createdByUsername || '—'}</td>

                      {/* Actions */}
                      <td className={styles.actionsCell}>
                        {!expired && !exhausted && (
                          <button
                            className={styles.actionBtn}
                            onClick={() => handleToggle(c._id)}
                            disabled={toggling === c._id}
                            title={c.isActive ? 'Désactiver' : 'Activer'}
                          >
                            {toggling === c._id ? '…' : c.isActive ? (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="1" y="5" width="22" height="14" rx="7" ry="7"/>
                                <circle cx="16" cy="12" r="3" fill="currentColor"/>
                              </svg>
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="1" y="5" width="22" height="14" rx="7" ry="7"/>
                                <circle cx="8" cy="12" r="3" fill="currentColor"/>
                              </svg>
                            )}
                          </button>
                        )}
                        <button
                          className={`${styles.actionBtn} ${styles.deleteBtn}`}
                          onClick={() => handleDelete(c._id)}
                          disabled={deleting === c._id}
                          title="Supprimer"
                        >
                          {deleting === c._id ? '…' : (
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

                    {/* Ligne expandable : liste des users inscrits */}
                    {expanded === c._id && c.usedBy?.length > 0 && (
                      <tr className={styles.expandedRow}>
                        <td colSpan={6}>
                          <div className={styles.usedByList}>
                            <p className={styles.usedByTitle}>Utilisateurs inscrits via ce code</p>
                            {c.usedBy.map((u, i) => (
                              <div key={i} className={styles.usedByItem}>
                                <span className={styles.usedByUsername}>{u.username}</span>
                                <span className={styles.usedByEmail}>{u.email}</span>
                                <span className={styles.usedByDate}>{fmtDate(u.usedAt)}</span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// ── Composant principal avec onglets ──────────────────────────────────────────
export default function InvitationsPanel() {
  const [tab, setTab] = useState('email');

  return (
    <div className={styles.panel}>
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
        <p className={styles.panelSubtitle}>Invitez des utilisateurs à rejoindre la plateforme.</p>
      </div>

      {/* Onglets */}
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${tab === 'email' ? styles.tabActive : ''}`}
          onClick={() => setTab('email')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
            <polyline points="22,6 12,13 2,6"/>
          </svg>
          Invitation par email
        </button>
        <button
          className={`${styles.tab} ${tab === 'codes' ? styles.tabActive : ''}`}
          onClick={() => setTab('codes')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            <line x1="12" y1="15" x2="12" y2="17"/>
          </svg>
          Codes d'invitation
        </button>
      </div>

      {tab === 'email' ? <EmailTab /> : <CodesTab />}
    </div>
  );
}
