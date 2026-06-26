import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axiosAdmin from '../axiosAdmin';
import { getAvatarColor } from '../utils/avatarColor';
import styles from './GlobalSearch.module.css';

const ICONS = {
  search: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  ),
  request: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
      <rect x="9" y="3" width="6" height="4" rx="1"/>
      <path d="M9 12h6M9 16h4"/>
    </svg>
  ),
  book: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
    </svg>
  ),
  user: (
    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  ),
};

const STATUS_LABEL = { pending: 'En attente', completed: 'Complété', canceled: 'Annulé', reported: 'Signalé' };
const STATUS_BADGE = { pending: styles.badgePending, completed: styles.badgeCompleted, canceled: styles.badgeCanceled, reported: styles.badgeCanceled };
const READING_LABEL = { unread: 'À lire', reading: 'En cours', read: 'Lu' };
const READING_BADGE = { unread: styles.badgePending, reading: styles.badgeReading, read: styles.badgeRead };

function buildRows(results) {
  const rows = [];

  if (results.demandes?.length) {
    rows.push({ type: 'cat', label: 'Demandes' });
    results.demandes.forEach(r => rows.push({ type: 'demande', data: r }));
  }
  if (results.bibliotheque?.length) {
    rows.push({ type: 'sep' });
    rows.push({ type: 'cat', label: 'Bibliothèque' });
    results.bibliotheque.forEach(r => rows.push({ type: 'bibliotheque', data: r }));
  }
  if (results.toutesLesDemandes?.length) {
    rows.push({ type: 'sep' });
    rows.push({ type: 'cat', label: 'Toutes les demandes', admin: true });
    results.toutesLesDemandes.forEach(r => rows.push({ type: 'toutesLesDemandes', data: r }));
  }
  if (results.utilisateurs?.length) {
    rows.push({ type: 'sep' });
    rows.push({ type: 'cat', label: 'Utilisateurs', admin: true });
    results.utilisateurs.forEach(r => rows.push({ type: 'utilisateur', data: r }));
  }

  return rows;
}

export default function GlobalSearch({ onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({});
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => { inputRef.current?.focus(); }, []);

  const search = useCallback((q) => {
    if (q.length < 2) { setResults({}); return; }
    setLoading(true);
    axiosAdmin.get('/api/search', { params: { q } })
      .then(res => { setResults(res.data.results); setActiveIdx(0); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleChange = (e) => {
    const q = e.target.value;
    setQuery(q);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(q), 280);
  };

  const rows = buildRows(results);
  const navigableRows = rows.filter(r => !['cat', 'sep'].includes(r.type));

  const handleNavigate = useCallback((row) => {
    if (!row) return;
    onClose();
    if (row.type === 'demande' || row.type === 'toutesLesDemandes') navigate('/dashboard');
    else if (row.type === 'bibliotheque') navigate('/reading');
    else if (row.type === 'utilisateur') navigate(`/admin?tab=users&q=${encodeURIComponent(row.data.username)}`);
  }, [navigate, onClose]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, navigableRows.length - 1)); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
      if (e.key === 'Enter')     { handleNavigate(navigableRows[activeIdx]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigableRows, activeIdx, onClose, handleNavigate]);

  let navIdx = -1;

  return (
    <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={styles.panel} role="dialog" aria-label="Recherche globale">
        <div className={styles.searchBar}>
          <span className={styles.searchIcon}>{ICONS.search}</span>
          <input
            ref={inputRef}
            className={styles.input}
            type="text"
            placeholder="Rechercher un livre, auteur, utilisateur…"
            value={query}
            onChange={handleChange}
            autoComplete="off"
          />
          <span className={styles.kbd}>Esc</span>
        </div>

        {query.length >= 2 && (
          <div className={styles.results}>
            {loading && <div className={styles.empty}>Recherche…</div>}
            {!loading && rows.length === 0 && <div className={styles.empty}>Aucun résultat pour « {query} »</div>}
            {!loading && rows.map((row, i) => {
              if (row.type === 'sep') return <hr key={i} className={styles.sep} />;
              if (row.type === 'cat') return (
                <div key={i} className={styles.catLabel}>
                  {row.label}
                  {row.admin && <span className={styles.adminTag}>Admin</span>}
                </div>
              );

              navIdx++;
              const myIdx = navIdx;
              const isActive = myIdx === activeIdx;
              const { data } = row;

              if (row.type === 'demande' || row.type === 'toutesLesDemandes') return (
                <div key={i} className={`${styles.row} ${isActive ? styles.rowActive : ''}`}
                  onMouseEnter={() => setActiveIdx(myIdx)}
                  onClick={() => handleNavigate(row)}>
                  <span className={styles.rowIcon}>{ICONS.request}</span>
                  <div className={styles.rowBody}>
                    <p className={styles.rowTitle}>{data.title} — {data.author}</p>
                    <p className={styles.rowSub}>
                      {row.type === 'toutesLesDemandes' ? `${data.username} · ` : ''}
                      {data.format || 'epub'} · {new Date(data.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                    </p>
                  </div>
                  <span className={`${styles.badge} ${STATUS_BADGE[data.status] || ''}`}>{STATUS_LABEL[data.status] || data.status}</span>
                </div>
              );

              if (row.type === 'bibliotheque') return (
                <div key={i} className={`${styles.row} ${isActive ? styles.rowActive : ''}`}
                  onMouseEnter={() => setActiveIdx(myIdx)}
                  onClick={() => handleNavigate(row)}>
                  <span className={styles.rowIcon}>{ICONS.book}</span>
                  <div className={styles.rowBody}>
                    <p className={styles.rowTitle}>{data.title} — {data.author}</p>
                    <p className={styles.rowSub}>
                      {READING_LABEL[data.status] || data.status}
                      {data.readingProgress > 0 ? ` · ${data.readingProgress}% lu` : ''}
                    </p>
                  </div>
                  <span className={`${styles.badge} ${READING_BADGE[data.status] || ''}`}>{READING_LABEL[data.status] || data.status}</span>
                </div>
              );

              if (row.type === 'utilisateur') return (
                <div key={i} className={`${styles.row} ${isActive ? styles.rowActive : ''}`}
                  onMouseEnter={() => setActiveIdx(myIdx)}
                  onClick={() => handleNavigate(row)}>
                  <div className={styles.avatar} style={{ background: getAvatarColor({ role: data.role }) }}>
                    {data.username[0]?.toUpperCase()}
                  </div>
                  <div className={styles.rowBody}>
                    <p className={styles.rowTitle}>{data.username}</p>
                    <p className={styles.rowSub}>
                      {data.role}
                      {data.lastActivity ? ` · actif ${new Date(data.lastActivity).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}` : ''}
                    </p>
                  </div>
                </div>
              );

              return null;
            })}
          </div>
        )}

        <div className={styles.footer}>
          <span className={styles.hint}><span className={styles.kbd}>↑↓</span> naviguer</span>
          <span className={styles.hint}><span className={styles.kbd}>↵</span> ouvrir</span>
          <span className={styles.hint}><span className={styles.kbd}>⌘K</span> ouvrir / fermer</span>
        </div>
      </div>
    </div>
  );
}
