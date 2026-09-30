import React, { useEffect, useState } from 'react';
import axiosAdmin from '../axiosAdmin';
import styles from './PublicLibraryPage.module.css';

const Stars = ({ rating }) => (
  <div className={styles.stars}>
    {[1, 2, 3, 4, 5].map(n => (
      <svg key={n} width="13" height="13" viewBox="0 0 24 24"
        fill={n <= rating ? '#f59e0b' : 'none'} stroke={n <= rating ? '#f59e0b' : 'var(--color-text-muted)'}
        strokeWidth="2">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    ))}
  </div>
);

export default function PublicLibraryPage() {
  // useParams() ne fonctionne pas hors de <Routes> — même pattern que ResetPassword.jsx.
  const token = window.location.pathname.split('/library/')[1];
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    axiosAdmin.get(`/api/reading/public/${token}`)
      .then(res => setData(res.data))
      .catch(err => setError(err.response?.data?.message || 'Bibliothèque introuvable.'));
  }, [token]);

  if (error) {
    return (
      <div className={styles.page}>
        <div className={styles.centerMessage}>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={styles.page}>
        <div className={styles.loading}><div className={styles.spinner} /></div>
      </div>
    );
  }

  const books = data.books.filter(b => {
    if (filter === 'read') return b.status === 'read';
    if (filter === 'unread') return b.status === 'unread';
    return true;
  });
  const readCount = data.books.filter(b => b.status === 'read').length;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <img src="/img/logo.png" alt="EbookRequest" className={styles.logo} />
        <h1 className={styles.title}>Bibliothèque de {data.username}</h1>
        <p className={styles.subtitle}>{data.books.length} livre{data.books.length > 1 ? 's' : ''} · {readCount} lu{readCount > 1 ? 's' : ''}</p>
      </div>

      <div className={styles.filters}>
        {[
          { id: 'all', label: 'Tous' },
          { id: 'read', label: 'Lus' },
          { id: 'unread', label: 'Non lus' },
        ].map(f => (
          <button key={f.id} type="button"
            className={`${styles.filterBtn} ${filter === f.id ? styles.filterBtnActive : ''}`}
            onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>

      {books.length === 0 ? (
        <p className={styles.empty}>Aucun livre dans cette catégorie.</p>
      ) : (
        <div className={styles.grid}>
          {books.map((b, i) => (
            <div key={i} className={styles.card}>
              <div className={styles.thumbWrap}>
                {b.thumbnail ? (
                  <img src={b.thumbnail} alt="" className={styles.thumb} />
                ) : (
                  <div className={styles.thumbPlaceholder}>
                    <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                    </svg>
                  </div>
                )}
                <span className={`${styles.badge} ${b.status === 'read' ? styles.badgeRead : styles.badgeUnread}`}>
                  {b.status === 'read' ? 'Lu' : 'Non lu'}
                </span>
              </div>
              <p className={styles.cardTitle} title={b.title}>{b.title}</p>
              <p className={styles.cardAuthor}>{b.author}</p>
              {b.rating > 0 && <Stars rating={b.rating} />}
              {b.notes && <p className={styles.cardNotes}>{b.notes}</p>}
            </div>
          ))}
        </div>
      )}

      <p className={styles.footer}>
        Propulsé par <a href="/" target="_blank" rel="noopener noreferrer">EbookRequest</a>
      </p>
    </div>
  );
}
