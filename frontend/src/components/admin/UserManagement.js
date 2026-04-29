import React, { useState, useEffect } from 'react';
import axiosAdmin from '../../axiosAdmin';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import styles from './UserManagement.module.css';

const getAvatarColor = (username) => {
  const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#14b8a6'];
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
};

const UserAvatar = ({ user }) => {
  if (user.avatar) {
    return <img src={user.avatar} alt={user.username} className={styles.avatarImg} />;
  }
  return (
    <div className={styles.avatar} style={{ background: getAvatarColor(user.username) }}>
      {user.username.charAt(0).toUpperCase()}
    </div>
  );
};

const SortIcon = ({ column, sortConfig }) => {
  const active = sortConfig.key === column;
  const asc = active && sortConfig.direction === 'asc';
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round"
      style={{ opacity: active ? 1 : 0.3, color: active ? 'var(--color-accent)' : 'currentColor', flexShrink: 0 }}>
      {asc
        ? <polyline points="18 15 12 9 6 15" />
        : <polyline points="6 9 12 15 18 9" />
      }
    </svg>
  );
};

const SORT_OPTIONS = [
  { key: 'username',  label: 'Nom' },
  { key: 'role',      label: 'Rôle' },
  { key: 'lastLogin', label: 'Connexion' },
];

const UserManagement = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({ _id: '', username: '', email: '', password: '', role: 'user', requestLimit: 10 });
  const [errors, setErrors] = useState({});
  const [deletingId, setDeletingId] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 10;
  const [sortConfig, setSortConfig] = useState({ key: 'createdAt', direction: 'desc' });
  const [searchTerm, setSearchTerm] = useState('');
  const [userStats, setUserStats] = useState(null);

  const filteredUsers = users.filter(user => {
    if (!searchTerm) return true;
    const s = searchTerm.toLowerCase();
    return (
      (user.username || '').toLowerCase().includes(s) ||
      (user.email || '').toLowerCase().includes(s) ||
      (user.role || '').toLowerCase().includes(s)
    );
  });

  const sortedUsers = [...filteredUsers].sort((a, b) => {
    if (a[sortConfig.key] < b[sortConfig.key]) return sortConfig.direction === 'asc' ? -1 : 1;
    if (a[sortConfig.key] > b[sortConfig.key]) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  const totalPages = Math.ceil(sortedUsers.length / ITEMS_PER_PAGE);
  const currentUsers = sortedUsers.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE);

  const formatDate = (dateString) => {
    if (!dateString) return '—';
    return format(new Date(dateString), 'd MMM yyyy', { locale: fr });
  };

  const formatDateTime = (dateString) => {
    if (!dateString) return '—';
    return format(new Date(dateString), 'd MMM yyyy, HH:mm', { locale: fr });
  };

  const requestSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
    setCurrentPage(1);
  };

  const handleSearch = (e) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1);
  };

  useEffect(() => { fetchUsers(); }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const response = await axiosAdmin.get('/api/admin/users');
      setUsers(response.data.map(u => ({ ...u, isEmailVerified: u.emailVerified || false })));
    } catch (err) {
      toast.error('Erreur lors du chargement des utilisateurs');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: '' }));
  };

  const validateForm = () => {
    const newErrors = {};
    if (!formData.username.trim()) newErrors.username = 'Le nom est requis';
    if (!formData.email) newErrors.email = 'L\'email est requis';
    else if (!/\S+@\S+\.\S+/.test(formData.email)) newErrors.email = 'Email invalide';
    if (!formData._id || formData.password) {
      if (!formData.password) newErrors.password = 'Le mot de passe est requis';
      else if (formData.password.length < 6) newErrors.password = 'Minimum 6 caractères';
    }
    if (!formData.role) newErrors.role = 'Le rôle est requis';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    try {
      const userData = { ...formData };
      if (!userData.password) delete userData.password;
      if (userData._id) {
        await axiosAdmin.put(`/api/admin/users/${userData._id}`, userData);
        toast.success('Utilisateur mis à jour');
      } else {
        await axiosAdmin.post('/api/admin/users', userData);
        toast.success('Utilisateur créé');
      }
      resetForm();
      fetchUsers();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Une erreur est survenue');
    }
  };

  const resetForm = () => {
    setFormData({ _id: '', username: '', email: '', password: '', role: 'user', requestLimit: 10 });
    setErrors({});
    setShowModal(false);
  };

  const handleEdit = (user) => {
    setFormData({ _id: user._id, username: user.username, email: user.email, password: '', role: user.role, requestLimit: user.requestLimit ?? 10 });
    setUserStats(null);
    setShowModal(true);
    axiosAdmin.get(`/api/admin/user-stats/${user._id}`)
      .then(res => setUserStats(res.data))
      .catch(() => {});
  };

  const handleToggleActive = async (user) => {
    try {
      const res = await axiosAdmin.patch(`/api/admin/users/${user._id}/toggle-active`);
      setUsers(prev => prev.map(u => u._id === user._id ? { ...u, isActive: res.data.isActive } : u));
      toast.success(res.data.isActive ? `${user.username} activé` : `${user.username} désactivé`);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Erreur lors de la mise à jour');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Supprimer cet utilisateur ?')) return;
    try {
      setDeletingId(id);
      await axiosAdmin.delete(`/api/admin/users/${id}`);
      toast.success('Utilisateur supprimé');
      fetchUsers();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Erreur lors de la suppression');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className={styles.container}>

      {/* ── Barre recherche ── */}
      <div className={styles.searchContainer}>
        <span className={styles.searchIcon}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </span>
        <input
          type="text"
          placeholder="Rechercher un utilisateur..."
          value={searchTerm}
          onChange={handleSearch}
          className={styles.searchInput}
        />
      </div>

      {/* ── Tri pills ── */}
      <div className={styles.sortBar}>
        {SORT_OPTIONS.map(({ key, label }) => (
          <button
            key={key}
            className={`${styles.sortPill} ${sortConfig.key === key ? styles.sortPillActive : ''}`}
            onClick={() => requestSort(key)}
          >
            {label}
            <SortIcon column={key} sortConfig={sortConfig} />
          </button>
        ))}
      </div>

      {/* ── Liste ── */}
      {loading ? (
        <div className={styles.loading}>Chargement...</div>
      ) : currentUsers.length === 0 ? (
        <div className={styles.empty}>Aucun utilisateur trouvé</div>
      ) : (
        <div className={styles.userList}>
          {currentUsers.map(user => (
            <div key={user._id} className={`${styles.userCard} ${user.isActive === false ? styles.userCardDisabled : ''}`}>
              <UserAvatar user={user} />

              <div className={styles.userInfo}>
                <div className={styles.userNameRow}>
                  <span className={styles.userName}>{user.username}</span>
                  <span className={`${styles.roleBadge} ${user.role === 'admin' ? styles.adminBadge : styles.userBadge}`}>
                    {user.role === 'admin' ? 'Admin' : 'Utilisateur'}
                  </span>
                  {user.isActive === false && (
                    <span className={styles.disabledBadge}>Désactivé</span>
                  )}
                </div>
                <div className={styles.userEmail}>{user.email}</div>
              </div>

              <div className={styles.userActivity}>
                <span className={styles.activityLabel}>Dernière connexion</span>
                <span className={styles.activityValue}>{formatDate(user.lastLogin)}</span>
              </div>

              <div className={styles.cardActions}>
                <button
                  className={user.isActive === false ? styles.activateBtn : styles.deactivateBtn}
                  onClick={() => handleToggleActive(user)}
                  title={user.isActive === false ? 'Activer le compte' : 'Désactiver le compte'}
                >
                  {user.isActive === false
                    ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
                    : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
                  }
                </button>
                <button
                  className={styles.editBtn}
                  onClick={() => handleEdit(user)}
                  title="Modifier"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
                <button
                  className={styles.deleteBtn}
                  onClick={() => handleDelete(user._id)}
                  disabled={deletingId === user._id}
                  title="Supprimer"
                >
                  {deletingId === user._id
                    ? <span className={styles.spinner} />
                    : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                      </svg>
                  }
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className={styles.pagination}>
          <button
            onClick={() => setCurrentPage(p => Math.max(p - 1, 1))}
            disabled={currentPage === 1}
            className={styles.pageBtn}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
          </button>

          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            let p;
            if (totalPages <= 5) p = i + 1;
            else if (currentPage <= 3) p = i + 1;
            else if (currentPage >= totalPages - 2) p = totalPages - 4 + i;
            else p = currentPage - 2 + i;
            return p > 0 && p <= totalPages ? (
              <button key={p} onClick={() => setCurrentPage(p)}
                className={`${styles.pageBtn} ${currentPage === p ? styles.pageBtnActive : ''}`}>
                {p}
              </button>
            ) : null;
          })}

          <button
            onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))}
            disabled={currentPage === totalPages}
            className={styles.pageBtn}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
          </button>

          <span className={styles.pageInfo}>
            {currentPage}/{totalPages} · {sortedUsers.length} utilisateur{sortedUsers.length > 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* ── Bouton ajouter ── */}
      <div className={styles.addButtonContainer}>
        <button className={styles.addButton} onClick={() => setShowModal(true)}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Ajouter un utilisateur
        </button>
      </div>

      {/* ── Modal ── */}
      {showModal && (
        <div className={styles.modalOverlay} onClick={resetForm}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>
                {formData._id ? 'Modifier un utilisateur' : 'Ajouter un utilisateur'}
              </h3>
              <button type="button" className={styles.closeButton} onClick={resetForm}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            <div className={styles.modalBody}>
              <form onSubmit={handleSubmit}>
                <div className={styles.formGrid}>
                  <div className={styles.formGroup}>
                    <label>Nom d'utilisateur *</label>
                    <input type="text" name="username" value={formData.username} onChange={handleInputChange}
                      className={`${styles.formInput} ${errors.username ? styles.inputError : ''}`} placeholder="Nom d'utilisateur" />
                    {errors.username && <span className={styles.errorText}>{errors.username}</span>}
                  </div>

                  <div className={styles.formGroup}>
                    <label>Email *</label>
                    <input type="email" name="email" value={formData.email} onChange={handleInputChange}
                      className={`${styles.formInput} ${errors.email ? styles.inputError : ''}`} placeholder="email@exemple.com" />
                    {errors.email && <span className={styles.errorText}>{errors.email}</span>}
                  </div>

                  <div className={styles.formGroup}>
                    <label>Mot de passe {formData._id ? '(vide = inchangé)' : '*'}</label>
                    <input type="password" name="password" value={formData.password} onChange={handleInputChange}
                      className={`${styles.formInput} ${errors.password ? styles.inputError : ''}`} placeholder="••••••••" />
                    {errors.password && <span className={styles.errorText}>{errors.password}</span>}
                  </div>

                  <div className={styles.formGroup}>
                    <label>Rôle *</label>
                    <select name="role" value={formData.role} onChange={handleInputChange}
                      className={`${styles.formInput} ${errors.role ? styles.inputError : ''}`}>
                      <option value="user">Utilisateur</option>
                      <option value="admin">Administrateur</option>
                    </select>
                    {errors.role && <span className={styles.errorText}>{errors.role}</span>}
                  </div>

                  <div className={styles.formGroup}>
                    <label>Limite de demandes (30 jours)</label>
                    <input type="number" name="requestLimit" value={formData.requestLimit}
                      onChange={handleInputChange} className={styles.formInput} min="0" />
                  </div>
                </div>

                {formData._id && (
                  <>
                    <div className={styles.userStats}>
                      {[
                        { label: 'Inscription', value: formatDateTime(users.find(u => u._id === formData._id)?.createdAt) },
                        { label: 'Dernière connexion', value: formatDateTime(users.find(u => u._id === formData._id)?.lastLogin) },
                        { label: 'Dernière activité', value: formatDateTime(users.find(u => u._id === formData._id)?.lastActivity) },
                      ].map(({ label, value }) => (
                        <div key={label} className={styles.statItem}>
                          <span className={styles.statLabel}>{label}</span>
                          <span className={styles.statValue}>{value}</span>
                        </div>
                      ))}
                    </div>
                    {userStats && (
                      <div className={styles.requestStats}>
                        <div className={styles.requestStatItem}>
                          <span className={styles.requestStatValue}>{userStats.total}</span>
                          <span className={styles.requestStatLabel}>demandes total</span>
                        </div>
                        <div className={styles.requestStatItem}>
                          <span className={styles.requestStatValue} style={{ color: '#10b981' }}>{userStats.completed}</span>
                          <span className={styles.requestStatLabel}>complétées</span>
                        </div>
                        <div className={styles.requestStatItem}>
                          <span className={styles.requestStatValue} style={{ color: '#f59e0b' }}>{userStats.pending}</span>
                          <span className={styles.requestStatLabel}>en attente</span>
                        </div>
                        <div className={styles.requestStatItem}>
                          <span className={styles.requestStatValue} style={{ color: userStats.recentCount >= (users.find(u => u._id === formData._id)?.requestLimit ?? 10) ? '#ef4444' : 'var(--color-text)' }}>
                            {userStats.recentCount} / {users.find(u => u._id === formData._id)?.requestLimit ?? 10}
                          </span>
                          <span className={styles.requestStatLabel}>quota 30j</span>
                        </div>
                      </div>
                    )}
                  </>
                )}

                <div className={styles.formActions}>
                  <button type="button" className={styles.cancelButton} onClick={resetForm}>Annuler</button>
                  <button type="submit" className={styles.saveButton} disabled={loading}>
                    {loading ? <span className={styles.spinner} /> : formData._id ? 'Mettre à jour' : 'Créer'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserManagement;