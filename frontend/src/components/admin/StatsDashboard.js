import React, { useEffect, useState } from 'react';
import { Doughnut, Bar, Line } from 'react-chartjs-2';
import axiosAdmin from '../../axiosAdmin';
import styles from './StatsDashboard.module.css';
import {
  Chart as ChartJS,
  ArcElement,
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
  ArcElement,
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

  // Données pour le graphique circulaire des requêtes
  const requestsData = {
    labels: ['En attente', 'Complétées', 'Signalées', 'Annulées'],
    datasets: [
      {
        data: [
          stats.requests.pending,
          stats.requests.completed,
          stats.requests.reported || 0,
          stats.requests.cancelled || 0
        ],
        backgroundColor: ['#F59E0B', '#10B981', '#9C27B0', '#EF4444'],
        borderColor: ['#F59E0B', '#10B981', '#9C27B0', '#EF4444'],
        borderWidth: 1,
      },
    ],
  };

  // Données pour le graphique à barres
  const usersData = {
    labels: ['Utilisateurs', 'Requêtes'],
    datasets: [
      {
        label: 'Total',
        data: [stats.users.total, stats.requests.total],
        backgroundColor: ['#6366F1', '#8B5CF6'],
        borderColor: ['#6366F1', '#8B5CF6'],
        borderWidth: 1,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          color: '#f8fafc',
          padding: 20,
          font: {
            size: 13,
            family: 'Inter, system-ui, -apple-system, sans-serif',
            weight: 500,
            lineHeight: 1.6
          },
          usePointStyle: true,
          pointStyle: 'circle',
          boxWidth: 8,
          padding: 12,
          boxPadding: 10,
          generateLabels: function(chart) {
            const data = chart.data;
            if (data.labels.length && data.datasets.length) {
              return data.labels.map((label, i) => {
                const dataset = data.datasets[0];
                const value = dataset.data[i];
                const color = dataset.backgroundColor[i];
                
                return {
                  text: `${label} (${value})`,
                  fillStyle: color,
                  strokeStyle: color,
                  lineWidth: 1,
                  hidden: isNaN(dataset.data[i]) || chart.getDatasetMeta(0).data[i].hidden,
                  index: i
                };
              });
            }
            return [];
          }
        },
        align: 'center',
        maxHeight: 100,
        title: {
          display: true,
          padding: {top: 10, bottom: 15}
        }
      },
      tooltip: {
        enabled: true,
        mode: 'index',
        intersect: false,
        backgroundColor: 'rgba(30, 41, 59, 0.95)',
        titleFont: {
          size: 12,
          weight: '600'
        },
        bodyFont: {
          size: 13,
          weight: '500'
        },
        padding: 12,
        cornerRadius: 8,
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)'
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        display: false,
        grid: {
          display: false,
        },
        ticks: {
          display: false,
        },
      },
      x: {
        display: false,
        grid: {
          display: false,
        },
        ticks: {
          display: false,
        },
      },
    },
    elements: {
      arc: {
        borderWidth: 3,
        borderColor: 'var(--color-bg2)'
      }
    },
    cutout: '75%',
    layout: {
      padding: {
        top: 10,
        bottom: 10,
        left: 10,
        right: 10
      }
    },
    spacing: 0,
    animation: {
      animateScale: true,
      animateRotate: true
    }
  };

  return (
    <div className={styles.statsContainer}>
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <h3>Utilisateurs</h3>
          <p className={styles.statNumber}>{stats.users.total}</p>
          <p className={styles.statLabel}>Total des utilisateurs</p>
        </div>

        <div className={styles.statCard}>
          <h3>Requêtes</h3>
          <p className={styles.statNumber}>{stats.requests.total}</p>
          <p className={styles.statLabel}>Total des requêtes</p>
        </div>

        <div className={styles.statCard}>
          <h3>En attente</h3>
          <p className={styles.statNumber}>{stats.requests.pending}</p>
          <p className={styles.statLabel}>Requêtes en attente</p>
        </div>

        <div className={styles.statCard}>
          <h3>Complétées</h3>
          <p className={styles.statNumber}>{stats.requests.completed}</p>
          <p className={styles.statLabel}>Requêtes complétées</p>
        </div>

        <div className={styles.statCard}>
          <h3>Annulées</h3>
          <p className={styles.statNumber}>{stats.requests.cancelled}</p>
          <p className={styles.statLabel}>Requêtes annulées</p>
        </div>

        <div className={styles.statCard}>
          <h3>Signalements</h3>
          <p className={styles.statNumber}>{stats.requests.reported || 0}</p>
          <p className={styles.statLabel}>Problèmes signalés</p>
        </div>

        <div className={styles.statCard}>
          {(() => {
            const ai = stats.aiProvider;
            const providerLabels = {
              openai: 'OpenAI / ChatGPT',
              ollama: 'Ollama (local)',
              anthropic: 'Claude / Anthropic',
            };
            const label = providerLabels[ai?.provider] || ai?.provider || 'IA';
            return (
              <>
                <h3>Statut {label}</h3>
                <div className={styles.ollamaStatus}>
                  <div className={styles.statusIndicator}>
                    <span className={`${styles.statusDot} ${ai?.connected ? styles.connected : styles.disconnected}`}></span>
                    <span className={styles.statusText}>{ai?.connected ? 'Connecté' : 'Déconnecté'}</span>
                  </div>
                  {ai?.connected && (
                    <>
                      <p className={styles.ollamaModel}>
                        <strong>Modèle :</strong> {ai.model}
                      </p>
                      {ai.provider === 'ollama' && (
                        ai.modelAvailable
                          ? <p className={styles.modelStatus}>✓ Modèle disponible</p>
                          : <p className={styles.modelStatusWarning}>⚠ Modèle non disponible</p>
                      )}
                    </>
                  )}
                  {ai?.error && <p className={styles.ollamaError}>{ai.error}</p>}
                </div>
              </>
            );
          })()}
        </div>

        <div className={styles.statCard}>
          <h3>Requêtes IA</h3>
          <p className={styles.statNumber}>{stats.aiRequests?.total || 0}</p>
          <p className={styles.statLabel}>Total des requêtes</p>
        </div>

        <div className={styles.statCard}>
          <h3>Taux de succès IA</h3>
          <p className={styles.statNumber}>{stats.aiRequests?.successRate || 0}%</p>
          <p className={styles.statLabel}>
            {stats.aiRequests?.successful || 0} réussies / {stats.aiRequests?.failed || 0} échouées
          </p>
        </div>

        <div className={styles.statCard}>
          <h3>Temps moyen</h3>
          <p className={styles.statNumber}>
            {stats.aiRequests?.avgResponseTime
              ? `${(stats.aiRequests.avgResponseTime / 1000).toFixed(1)}s`
              : '0s'}
          </p>
          <p className={styles.statLabel}>Temps de réponse IA</p>
        </div>
      </div>

      <div className={styles.chartsContainer}>
        <div className={styles.chartCard}>
          <h3>Répartition des requêtes</h3>
          <div className={styles.chartWrapper}>
            <Doughnut data={requestsData} options={options} />
          </div>
        </div>

        <div className={styles.chartCard}>
          <h3>Vue d'ensemble</h3>
          <div className={styles.chartWrapper}>
            <Bar data={usersData} options={options} />
          </div>
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
              const medals = ['🥇', '🥈', '🥉'];
              return (
                <div key={u.username} className={styles.topUserRow}>
                  <span className={styles.topUserRank}>{medals[i] || `#${i + 1}`}</span>
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