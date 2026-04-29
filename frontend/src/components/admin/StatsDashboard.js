import React, { useEffect, useState } from 'react';
import { Bar, Line } from 'react-chartjs-2';
import axiosAdmin from '../../axiosAdmin';
import styles from './StatsDashboard.module.css';
import {
  Chart as ChartJS,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Filler,
  Title
} from 'chart.js';

// Enregistrer les composants nécessaires de Chart.js
ChartJS.register(
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Filler,
  Title
);

const StatsDashboard = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await axiosAdmin.get('/api/admin/stats', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        setStats(response.data.data);
        setLoading(false);
      } catch (err) {
        console.error('Erreur lors de la récupération des statistiques:', {
          message: err.message,
          response: err.response ? {
            status: err.response.status,
            statusText: err.response.statusText,
            data: err.response.data
          } : 'Pas de réponse',
          config: {
            url: err.config?.url,
            method: err.config?.method,
            headers: err.config?.headers
          }
        });
        setError(`Erreur lors du chargement des statistiques: ${err.message}`);
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  if (loading) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.loadingSpinner}></div>
        <p>Chargement des statistiques...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.errorContainer}>
        <p className={styles.errorText}>{error}</p>
      </div>
    );
  }

  const tooltipBase = {
    backgroundColor: 'rgba(30, 41, 59, 0.95)',
    titleFont: { size: 12, weight: '600' },
    bodyFont: { size: 13 },
    padding: 10,
    cornerRadius: 8,
  };

  // Bar horizontal — répartition des statuts
  const repartitionData = {
    labels: ['En attente', 'Complétées', 'Signalées', 'Annulées'],
    datasets: [{
      data: [
        stats.requests.pending,
        stats.requests.completed,
        stats.requests.reported || 0,
        stats.requests.cancelled || 0,
      ],
      backgroundColor: [
        'rgba(245, 158, 11, 0.8)',
        'rgba(16, 185, 129, 0.8)',
        'rgba(156, 39, 176, 0.8)',
        'rgba(239, 68, 68, 0.8)',
      ],
      borderColor: ['#F59E0B', '#10B981', '#9C27B0', '#EF4444'],
      borderWidth: 0,
      borderRadius: 6,
      borderSkipped: false,
    }],
  };

  const repartitionOptions = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        ...tooltipBase,
        callbacks: {
          label: (item) => ` ${item.raw} demande${item.raw !== 1 ? 's' : ''}`,
        },
      },
    },
    scales: {
      x: {
        beginAtZero: true,
        grid: { color: 'rgba(255,255,255,0.05)' },
        ticks: { color: '#8b949e', font: { size: 11 }, stepSize: 1 },
      },
      y: {
        grid: { display: false },
        ticks: { color: '#8b949e', font: { size: 12 } },
      },
    },
  };


  return (
    <div className={styles.statsContainer}>

      <div className={styles.groupCard}>
        <div className={styles.groupHeader}>
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          <h3>Utilisateurs</h3>
          <span className={styles.groupTotalBadge}>{stats.users.total} au total</span>
        </div>
        <div className={styles.groupGrid}>
          <div className={styles.groupStat}>
            <span className={styles.groupValue}>{stats.users.active ?? '—'}</span>
            <span className={styles.groupLabel}>actifs ce mois</span>
          </div>
          <div className={styles.groupStat}>
            <span className={styles.groupValue}>{stats.users.new ?? '—'}</span>
            <span className={styles.groupLabel}>nouveaux ce mois</span>
          </div>
          <div className={styles.groupStat}>
            <span className={styles.groupValue}>{stats.users.withPending ?? '—'}</span>
            <span className={styles.groupLabel}>avec demandes en attente</span>
          </div>
        </div>
      </div>

      <div className={styles.groupCard}>
        <div className={styles.groupHeader}>
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
          </svg>
          <h3>Demandes</h3>
          <span className={styles.groupTotalBadge}>{stats.requests.total} au total</span>
        </div>
        <div className={styles.groupGrid}>
          <div className={styles.groupStat}>
            <span className={styles.groupValue}>{stats.requests.pending}</span>
            <span className={styles.groupLabel}>en attente</span>
          </div>
          <div className={styles.groupStat}>
            <span className={styles.groupValue}>{stats.requests.completed}</span>
            <span className={styles.groupLabel}>complétées</span>
          </div>
          <div className={styles.groupStat}>
            <span className={styles.groupValue}>{stats.requests.cancelled}</span>
            <span className={styles.groupLabel}>annulées</span>
          </div>
          <div className={styles.groupStat}>
            <span className={styles.groupValue}>{stats.requests.reported || 0}</span>
            <span className={styles.groupLabel}>signalements</span>
          </div>
        </div>
      </div>

      {(() => {
        const ai = stats.aiProvider;
        const providerLabels = {
          openai: 'OpenAI',
          ollama: 'Ollama',
        };
        const label = providerLabels[ai?.provider] || ai?.provider || 'IA';
        const avgTime = stats.aiRequests?.avgResponseTime
          ? `${(stats.aiRequests.avgResponseTime / 1000).toFixed(1)}s`
          : '—';
        return (
          <div className={styles.groupCard}>
            <div className={styles.groupHeader}>
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2M9 2v2M15 20v2M9 20v2M2 15h2M2 9h2M20 15h2M20 9h2"/>
              </svg>
              <h3>{label}</h3>
              <span className={`${styles.groupStatusBadge} ${ai?.connected ? styles.groupStatusConnected : styles.groupStatusDisconnected}`}>
                <span className={`${styles.statusDot} ${ai?.connected ? styles.connected : styles.disconnected}`}></span>
                {ai?.connected ? 'Connecté' : 'Déconnecté'}
              </span>
            </div>
            {ai?.connected && ai.model && (
              <p className={styles.groupSubInfo}>
                Modèle : <strong>{ai.model}</strong>
                {ai.provider === 'ollama' && (
                  ai.modelAvailable
                    ? <span className={styles.groupSubOk}> · disponible</span>
                    : <span className={styles.groupSubWarn}> · non disponible</span>
                )}
              </p>
            )}
            {ai?.error && (
              <p className={styles.groupError}>
                {ai.error.length > 100 ? ai.error.slice(0, 100) + '…' : ai.error}
              </p>
            )}
            <div className={styles.groupGrid}>
              <div className={styles.groupStat}>
                <span className={styles.groupValue}>{stats.aiRequests?.total || 0}</span>
                <span className={styles.groupLabel}>requêtes</span>
              </div>
              <div className={styles.groupStat}>
                <span className={styles.groupValue}>{stats.aiRequests?.successRate || 0}%</span>
                <span className={styles.groupLabel}>taux de succès</span>
              </div>
              <div className={styles.groupStat}>
                <span className={styles.groupValue}>{stats.aiRequests?.successful || 0}</span>
                <span className={styles.groupLabel}>réussies</span>
              </div>
              <div className={styles.groupStat}>
                <span className={`${styles.groupValue} ${(stats.aiRequests?.failed || 0) > 0 ? styles.groupWarnValue : ''}`}>{stats.aiRequests?.failed || 0}</span>
                <span className={styles.groupLabel}>échouées</span>
              </div>
            </div>
            {stats.aiRequests?.avgResponseTime > 0 && (
              <p className={styles.groupSubInfo} style={{ marginTop: '0.75rem' }}>
                Temps de réponse moyen : <strong>{avgTime}</strong>
              </p>
            )}
          </div>
        );
      })()}

      <div className={styles.chartCardWide}>
        <h3>Répartition des requêtes <span className={styles.chartSubtitle}>par statut</span></h3>
        <div className={styles.chartWrapperWide}>
          <Bar data={repartitionData} options={repartitionOptions} />
        </div>
      </div>

      {stats.requestsByWeek?.length > 0 && (
        <div className={styles.chartCardWide}>
          <h3>Demandes par semaine <span className={styles.chartSubtitle}>(12 dernières semaines)</span></h3>
          <div className={styles.chartWrapperWide}>
            <Line
              data={{
                labels: stats.requestsByWeek.map(w => w.label),
                datasets: [{
                  label: 'Demandes',
                  data: stats.requestsByWeek.map(w => w.count),
                  borderColor: '#4f8cff',
                  backgroundColor: 'rgba(79, 140, 255, 0.1)',
                  fill: true,
                  tension: 0.4,
                  pointBackgroundColor: '#4f8cff',
                  pointRadius: 4,
                  pointHoverRadius: 6,
                }]
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: { display: false },
                  tooltip: {
                    backgroundColor: 'rgba(30, 41, 59, 0.95)',
                    titleFont: { size: 12, weight: '600' },
                    bodyFont: { size: 13 },
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                      title: (items) => `Semaine du ${items[0].label}`,
                      label: (item) => ` ${item.raw} demande${item.raw !== 1 ? 's' : ''}`
                    }
                  }
                },
                scales: {
                  x: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#8b949e', font: { size: 11 } }
                  },
                  y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#8b949e', font: { size: 11 }, stepSize: 1 }
                  }
                }
              }}
            />
          </div>
        </div>
      )}
      
      {stats.topUsers?.length > 0 && (
        <div className={styles.topUsersCard}>
          <h3>Top utilisateurs</h3>
          <div className={styles.topUsersList}>
            {stats.topUsers.map((u, i) => {
              const pct = stats.requests.total > 0 ? Math.round((u.total / stats.requests.total) * 100) : 0;
              return (
                <div key={u.username} className={styles.topUserRow}>
                  <span className={styles.topUserRank}>#{i + 1}</span>
                  <span className={styles.topUserName}>{u.username}</span>
                  <div className={styles.topUserBar}>
                    <div className={styles.topUserBarFill} style={{ width: `${pct}%` }} />
                  </div>
                  <span className={styles.topUserCount}>{u.total} <span className={styles.topUserCompleted}>({u.completed} ✓)</span></span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {stats.valentine && (
        <div className={styles.groupCard}>
          <div className={styles.groupHeader}>
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
            <h3>Téléchargements automatiques</h3>
          </div>
          <div className={styles.groupGrid}>
            <div className={styles.groupStat}>
              <span className={styles.groupValue}>{stats.valentine.thisWeek}</span>
              <span className={styles.groupLabel}>cette semaine</span>
            </div>
            <div className={styles.groupStat}>
              <span className={styles.groupValue}>{stats.valentine.total}</span>
              <span className={styles.groupLabel}>au total</span>
            </div>
            <div className={styles.groupStat}>
              <span className={styles.groupValue}>{stats.valentine.successRate}%</span>
              <span className={styles.groupLabel}>des complétées</span>
            </div>
            <div className={`${styles.groupStat} ${stats.valentine.stuck > 0 ? styles.groupWarn : ''}`}>
              <span className={styles.groupValue}>{stats.valentine.stuck}</span>
              <span className={styles.groupLabel}>en attente +7j</span>
            </div>
          </div>
        </div>
      )}

      <div className={styles.completionRate}>
        <h3>Taux de complétion</h3>
        <div className={styles.progressBar}>
          <div 
            className={styles.progressFill} 
            style={{ width: `${stats.requests.completionRate}%` }}
          >
            {stats.requests.completionRate}%
          </div>
        </div>
      </div>
    </div>
  );
};

export default StatsDashboard;