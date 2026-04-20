import React, { useEffect } from 'react';
import styles from './BookPreviewModal.module.css';

const BookPreviewModal = ({ book, onClose }) => {
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  if (!book) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Fermer">×</button>

        <div className={styles.content}>
          {book.thumbnail && (
            <div className={styles.cover}>
              <img src={book.thumbnail} alt={`Couverture de ${book.title}`} />
            </div>
          )}

          <div className={styles.info}>
            <h2 className={styles.title}>{book.title}</h2>
            <p className={styles.author}>par {book.author}</p>

            <div className={styles.meta}>
              {book.pageCount > 0 && (
                <span className={styles.metaItem}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                  </svg>
                  {book.pageCount} pages
                </span>
              )}
              {book.status && (
                <span className={`${styles.metaItem} ${styles.statusBadge} ${styles[book.status]}`}>
                  {book.status === 'completed' ? 'Terminée' :
                   book.status === 'canceled' ? 'Annulée' :
                   book.status === 'reported' ? 'Signalée' : 'En attente'}
                </span>
              )}
              {book.username && (
                <span className={styles.metaItem}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                  </svg>
                  {book.username}
                </span>
              )}
              {book.createdAt && (
                <span className={styles.metaItem}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                  </svg>
                  {new Date(book.createdAt).toLocaleDateString('fr-FR')}
                </span>
              )}
            </div>

            {book.description && (
              <div className={styles.description}>
                <h3>Description</h3>
                <p>{book.description}</p>
              </div>
            )}

            {book.adminComment && (
              <div className={styles.adminComment}>
                <strong>Note admin :</strong> {book.adminComment}
              </div>
            )}

            <div className={styles.actions}>
              {book.link && (
                <a href={book.link} target="_blank" rel="noopener noreferrer" className={styles.linkBtn}>
                  Voir sur Google Books
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BookPreviewModal;