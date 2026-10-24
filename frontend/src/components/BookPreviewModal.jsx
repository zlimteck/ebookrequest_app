import React, { useEffect } from 'react';
import styles from './BookPreviewModal.module.css';
import { infoLinkSourceLabel, buildGoogleBooksLink, buildHardcoverLink, isCoveredByDedicatedButton } from '../utils/infoLinkSource';
import useQuickFollowAuthor from '../hooks/useQuickFollowAuthor';

const IconFollowAuthor = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="17" y1="11" x2="23" y2="11"/>
  </svg>
);

const IconFollowing = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/>
  </svg>
);

const BookPreviewModal = ({ book, onClose }) => {
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const { enabled: authorFollowEnabled, status: authorFollowStatus, error: authorFollowError, follow: followAuthor } = useQuickFollowAuthor();

  if (!book) return null;

  const authorName = book.author;
  const followStatus = authorFollowStatus[authorName];

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
            <div className={styles.authorRow}>
              <p className={styles.author}>par {book.author}</p>
              {authorFollowEnabled && authorName && (
                <button
                  type="button"
                  className={`${styles.followAuthorBtn} ${followStatus === 'followed' ? styles.followAuthorBtnActive : ''}`}
                  disabled={followStatus === 'busy' || followStatus === 'followed'}
                  onClick={() => followAuthor(authorName)}
                  title={
                    followStatus === 'followed' ? `Vous suivez ${authorName}`
                      : followStatus === 'error' ? authorFollowError[authorName]
                      : `Suivre ${authorName}`
                  }
                >
                  {followStatus === 'followed' ? <IconFollowing /> : <IconFollowAuthor />}
                  {followStatus === 'followed' ? 'Suivi' : 'Suivre l\'auteur'}
                </button>
              )}
            </div>

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
              {book.sourceLink && (
                <a href={book.sourceLink} target="_blank" rel="noopener noreferrer" className={styles.linkBtn}>
                  Voir sur {book.sourceConnector === 'fourtoutici' ? 'Fourtoutici' : 'Valentine'}
                </a>
              )}
              {book.link && !isCoveredByDedicatedButton(book.link) && (
                <a href={book.link} target="_blank" rel="noopener noreferrer" className={styles.linkBtn}>
                  Voir sur {infoLinkSourceLabel(book.link)}
                </a>
              )}
              <a href={buildGoogleBooksLink(book)} target="_blank" rel="noopener noreferrer" className={styles.linkBtn}>
                Voir sur Google Books
              </a>
              <a href={buildHardcoverLink(book)} target="_blank" rel="noopener noreferrer" className={styles.linkBtn}>
                Voir sur Hardcover
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BookPreviewModal;