import React, { useEffect, useState } from 'react';
import axiosAdmin from '../../axiosAdmin';
import styles from './UpdatesPanel.module.css';

const PER_PAGE = 10;

export default function UpdatesPanel() {
  const [releases, setReleases] = useState([]);
  const [currentVersion, setCurrentVersion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const load = async () => {
      try {
        const [relRes, healthRes] = await Promise.all([
          axiosAdmin.get('/api/admin/releases'),
          axiosAdmin.get('/api/health'),
        ]);
        setReleases(relRes.data);
        setCurrentVersion(healthRes.data.version);
      } catch {
        setError('Impossible de récupérer les informations de version.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const latestTag = releases[0]?.tag;
  const currentTag = currentVersion ? `v${currentVersion}` : null;
  const hasUpdate = latestTag && currentTag && latestTag !== currentTag;

  const totalPages = Math.ceil(releases.length / PER_PAGE);
  const paginated = releases.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  if (loading) return (
    <div className={styles.loader}>
      <div className={styles.spinner} />
    </div>
  );

  if (error) return <p className={styles.error}>{error}</p>;

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div className={styles.versionRow}>
          <span className={styles.versionLabel}>Version installée</span>
          <span className={styles.versionBadge}>{currentTag || '—'}</span>
          {hasUpdate && (
            <span className={styles.updateBadge}>
              Mise à jour disponible : {latestTag}
            </span>
          )}
          {!hasUpdate && currentTag && (
            <span className={styles.upToDate}>À jour</span>
          )}
        </div>
      </div>

      <div className={styles.timeline}>
        {paginated.map((r, i) => {
          const globalIndex = (page - 1) * PER_PAGE + i;
          const isCurrent = currentTag && r.tag === currentTag;
          return (
            <div key={r.id} className={`${styles.release} ${isCurrent ? styles.current : ''}`}>
              <div className={styles.releaseHeader}>
                <div className={styles.releaseMeta}>
                  <span className={styles.releaseTag}>{r.tag}</span>
                  {globalIndex === 0 && <span className={styles.latestBadge}>latest</span>}
                  {isCurrent && <span className={styles.installedBadge}>installée</span>}
                  {r.prerelease && <span className={styles.preBadge}>pre-release</span>}
                </div>
                <div className={styles.releaseRight}>
                  <span className={styles.releaseDate}>
                    {new Date(r.publishedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </span>
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className={styles.githubLink}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
                    </svg>
                    GitHub
                  </a>
                </div>
              </div>

              {r.body && (
                <div className={styles.releaseBody}>
                  {r.body.split('\n').filter(l => l.trim()).map((line, j) => {
                    // Lien "Full Changelog" → affiché en bas en discret
                    const changelogMatch = line.match(/\*{0,2}Full Changelog\*{0,2}.*?(https?:\/\/\S+)/);
                    if (changelogMatch) {
                      return (
                        <a key={j} href={changelogMatch[1]} target="_blank" rel="noopener noreferrer" className={styles.changelogLink}>
                          Voir le changelog complet
                        </a>
                      );
                    }
                    // Titres markdown
                    if (line.startsWith('#')) {
                      return <p key={j} className={styles.releaseLine}><strong>{line.replace(/^#+\s*/, '')}</strong></p>;
                    }
                    // Nettoyage : gras (**text**), puces, liens markdown [text](url)
                    const cleaned = line
                      .replace(/^[-*]\s+/, '• ')
                      .replace(/\*\*(.+?)\*\*/g, '$1')
                      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
                    return <p key={j} className={styles.releaseLine}>{cleaned}</p>;
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div className={styles.pagination}>
          <button
            className={styles.pageBtn}
            onClick={() => setPage(p => p - 1)}
            disabled={page === 1}
          >
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
            Précédent
          </button>
          <span className={styles.pageInfo}>{page} / {totalPages}</span>
          <button
            className={styles.pageBtn}
            onClick={() => setPage(p => p + 1)}
            disabled={page === totalPages}
          >
            Suivant
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}