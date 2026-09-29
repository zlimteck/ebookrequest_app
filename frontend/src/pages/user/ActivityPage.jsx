import React, { useEffect, useState, useCallback } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  Tooltip,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  Filler,
} from 'chart.js';
import axiosAdmin from '../../axiosAdmin';
import styles from './ActivityPage.module.css';

ChartJS.register(Tooltip, CategoryScale, LinearScale, LineElement, PointElement, Filler);

const CATEGORY_LABELS = { ebook: 'Ebook', comic: 'BD', manga: 'Manga' };
const CATEGORY_FILTERS = [
  { id: '', label: 'Toutes' },
  { id: 'ebook', label: 'Ebook' },
  { id: 'comic', label: 'BD' },
  { id: 'manga', label: 'Manga' },
];
const ORIGIN_LABELS = { auto: 'Automatique', manuel: 'Manuel (admin)' };
// Mêmes couleurs que les badges sur les couvertures (badgeAuto/badgeManual).
const ORIGIN_COLORS = { auto: '#10b981', manuel: '#6366f1' };
// Couleurs issues de la palette du site (App.module.css : accent2/warning/danger).
const CATEGORY_COLORS = { ebook: '#818cf8', comic: '#f59e0b', manga: '#ff4f4f' };
const CATEGORY_BADGE_CLASS = { ebook: 'badgeEbook', comic: 'badgeComic', manga: 'badgeManga' };

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('fr-FR');
}

function formatMonth(monthStr) {
  if (!monthStr) return '';
  const [year, month] = monthStr.split('-');
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

export default function ActivityPage() {
  const [data, setData] = useState(null);
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback((p, cat) => {
    setLoading(true);
    // Moins d'items par page sur mobile pour éviter un scroll trop long.
    const limit = window.innerWidth <= 480 ? 12 : 24;
    const params = new URLSearchParams({ page: p, limit });
    if (cat) params.set('category', cat);
    axiosAdmin.get(`/api/requests/activity?${params.toString()}`)
      .then(res => setData(res.data))
      .catch(() => setData({ enabled: true, items: [], total: 0, page: 1, pages: 0, stats: null }))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(page, category); }, [page, category, load]);

  const handleCategoryChange = (cat) => {
    setCategory(cat);
    setPage(1);
  };

  if (loading && !data) return (
    <div className={styles.loading}><div className={styles.spinner} /></div>
  );

  if (!data) return null;

  const topCategory = data.stats?.byCategory
    ? Object.entries(data.stats.byCategory).sort((a, b) => b[1] - a[1])[0]
    : null;

  // Pas de détail par connecteur (Valentine/Anna's Archive/...) côté user —
  // détail technique interne, seule la distinction auto/manuel est pertinente.
  const connectorEntries = data.stats
    ? [
        ['auto', Object.values(data.stats.byConnector || {}).reduce((a, b) => a + b, 0)],
        ['manuel', data.stats.manualCount || 0],
      ].filter(([, count]) => count > 0)
    : [];
  const connectorMax = connectorEntries.length ? Math.max(...connectorEntries.map(c => c[1])) : 0;

  const categoryEntries = data.stats?.byCategory
    ? Object.entries(data.stats.byCategory).filter(([, count]) => count > 0)
    : [];
  const categoryMax = categoryEntries.length ? Math.max(...categoryEntries.map(c => c[1])) : 0;

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>Activité de l'instance</h1>

      {!data.enabled ? (
        <p className={styles.empty}>Ce flux a été désactivé par un administrateur.</p>
      ) : (
        <>
          {data.stats && (
            <div className={styles.stats}>
              <div className={styles.statItem}>
                <span className={styles.statNum}>{data.stats.totalCompleted}</span>
                <span className={styles.statLabel}>Au total</span>
              </div>
              <div className={styles.statDivider} />
              <div className={styles.statItem}>
                <span className={styles.statNum}>{data.stats.completedThisMonth}</span>
                <span className={styles.statLabel}>Ce mois-ci</span>
              </div>
              <div className={styles.statDivider} />
              <div className={styles.statItem}>
                <span className={styles.statNum}>{topCategory ? (CATEGORY_LABELS[topCategory[0]] || topCategory[0]) : 'Aucune'}</span>
                <span className={styles.statLabel}>Catégorie la plus demandée</span>
              </div>
              {data.stats.bestMonth && (
                <>
                  <div className={styles.statDivider} />
                  <div className={styles.statItem}>
                    <span className={styles.statNum}>{data.stats.bestMonth.count}</span>
                    <span className={styles.statLabel}>Meilleur mois ({formatMonth(data.stats.bestMonth.month)})</span>
                  </div>
                </>
              )}
            </div>
          )}

          <div className={styles.categoryFilters}>
            {CATEGORY_FILTERS.map(f => (
              <button
                key={f.id}
                type="button"
                className={`${styles.filterBtn} ${category === f.id ? styles.filterBtnActive : ''}`}
                onClick={() => handleCategoryChange(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>

          {data.items.length === 0 ? (
            <p className={styles.empty}>Aucune demande complétée pour le moment.</p>
          ) : (
            <div className={styles.grid}>
              {data.items.map((item, i) => (
                <div key={i} className={styles.card}>
                  <div className={styles.thumbWrap}>
                    {item.thumbnail ? (
                      <img src={item.thumbnail} alt="" className={styles.thumb} />
                    ) : (
                      <div className={styles.thumbPlaceholder}>
                        <svg width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                        </svg>
                      </div>
                    )}
                    <div className={styles.badges}>
                      <span className={`${styles.badge} ${styles[CATEGORY_BADGE_CLASS[item.category]] || ''}`}>{CATEGORY_LABELS[item.category] || item.category}</span>
                      {item.format && <span className={styles.badge}>{item.format}</span>}
                      <span className={`${styles.badge} ${item.origin === 'manual' ? styles.badgeManual : styles.badgeAuto}`}>
                        {item.origin === 'manual' ? 'Manuel' : 'Auto'}
                      </span>
                    </div>
                  </div>
                  <p className={styles.cardTitle} title={item.title}>{item.title}</p>
                  <p className={styles.cardMeta}>{item.author} · {formatDate(item.completedAt)}</p>
                </div>
              ))}
            </div>
          )}

          {data.pages > 1 && (
            <div className={styles.pagination}>
              <button className={styles.pageBtn} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Précédent</button>
              <span className={styles.pageInfo}>Page {data.page} / {data.pages}</span>
              <button className={styles.pageBtn} disabled={page >= data.pages} onClick={() => setPage(p => p + 1)}>Suivant</button>
            </div>
          )}

          {data.stats?.dailyTrend?.length > 0 && (
            <div className={styles.chartCard}>
              <p className={styles.chartTitle}>Tendance sur 30 jours</p>
              <div className={styles.chartWrap}>
                <Line
                  data={{
                    labels: data.stats.dailyTrend.map(d => new Date(d.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })),
                    datasets: [{
                      data: data.stats.dailyTrend.map(d => d.count),
                      borderColor: '#6366f1',
                      backgroundColor: 'rgba(99,102,241,0.1)',
                      fill: true,
                      tension: 0.4,
                      pointRadius: 0,
                      pointHoverRadius: 4,
                    }],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: { display: false },
                      tooltip: {
                        backgroundColor: 'rgba(30,41,59,0.95)',
                        cornerRadius: 8,
                        callbacks: { label: (item) => ` ${item.raw} demande${item.raw !== 1 ? 's' : ''}` },
                      },
                    },
                    scales: {
                      x: { grid: { display: false }, ticks: { color: '#8b949e', font: { size: 10 }, maxTicksLimit: 8 } },
                      y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8b949e', font: { size: 10 }, stepSize: 1 } },
                    },
                  }}
                />
              </div>
            </div>
          )}

          {connectorEntries.length > 0 && (
            <div className={styles.chartCard}>
              <p className={styles.chartTitle}>Automatique vs manuel</p>
              <div className={styles.connectorBars}>
                {connectorEntries.map(([id, count]) => (
                  <div key={id} className={styles.connectorRow}>
                    <span className={styles.connectorLabel}>{ORIGIN_LABELS[id] || id}</span>
                    <div className={styles.connectorBarTrack}>
                      <div
                        className={styles.connectorBarFill}
                        style={{ width: `${connectorMax ? (count / connectorMax) * 100 : 0}%`, background: ORIGIN_COLORS[id] || '#6366f1' }}
                      />
                    </div>
                    <span className={styles.connectorCount}>{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {categoryEntries.length > 0 && (
            <div className={styles.chartCard}>
              <p className={styles.chartTitle}>Répartition par catégorie</p>
              <div className={styles.connectorBars}>
                {categoryEntries.map(([id, count]) => (
                  <div key={id} className={styles.connectorRow}>
                    <span className={styles.connectorLabel}>{CATEGORY_LABELS[id] || id}</span>
                    <div className={styles.connectorBarTrack}>
                      <div
                        className={styles.connectorBarFill}
                        style={{ width: `${categoryMax ? (count / categoryMax) * 100 : 0}%`, background: CATEGORY_COLORS[id] || '#6366f1' }}
                      />
                    </div>
                    <span className={styles.connectorCount}>{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
