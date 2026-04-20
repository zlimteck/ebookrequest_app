import React, { useState, useEffect, useRef } from 'react';
import { toast } from 'react-toastify';
import axiosAdmin from '../axiosAdmin';
import styles from './UserSettings.module.css';
import { compressImage } from '../utils/imageCompressor';
import { subscribeToPush, unsubscribeFromPush, isPushSubscribed } from '../serviceWorkerRegistration';

const getAvatarColor = (username) => {
  const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#14b8a6'];
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
};

const UserSettings = () => {
  const [user, setUser] = useState({
    email: '',
    username: '',
    notificationPreferences: {
      email: { enabled: false },
      push: { enabled: true }
    }
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const [avatar, setAvatar] = useState(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef(null);

  const [pushSupported, setPushSupported] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);

  const [showChangePassword, setShowChangePassword] = useState(false);
  const [passwordData, setPasswordData] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [passwordErrors, setPasswordErrors] = useState({});
  const [passwordStrength, setPasswordStrength] = useState(0);

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const response = await axiosAdmin.get('/api/users/me');
        if (response.data.success) {
          setUser(prev => ({
            ...prev,
            ...response.data.user,
            notificationPreferences: {
              email: { enabled: response.data.user.notificationPreferences?.email?.enabled || false },
              push: { enabled: response.data.user.notificationPreferences?.push?.enabled !== false }
            }
          }));
          if (response.data.user.avatar) setAvatar(response.data.user.avatar);
        }
      } catch (error) {
        toast.error('Erreur lors du chargement de votre profil');
      } finally {
        setIsLoading(false);
      }
    };
    fetchUserData();
  }, []);

  useEffect(() => {
    const checkPush = async () => {
      const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
      setPushSupported(supported);
      if (supported) setPushSubscribed(await isPushSubscribed());
    };
    checkPush();
  }, []);

  const checkPasswordStrength = (password) => {
    let s = 0;
    if (password.length >= 8) s++;
    if (password.match(/[a-z]+/)) s++;
    if (password.match(/[A-Z]+/)) s++;
    if (password.match(/[0-9]+/)) s++;
    if (password.match(/[!@#$%^&*(),.?":{}|<>]+/)) s++;
    return s;
  };

  const handlePasswordChange = (e) => {
    const { name, value } = e.target;
    setPasswordData(prev => {
      const next = { ...prev, [name]: value };
      if (name === 'newPassword') setPasswordStrength(checkPasswordStrength(value));
      if ((name === 'newPassword' || name === 'confirmPassword') && next.newPassword && next.confirmPassword) {
        setPasswordErrors(pe => ({
          ...pe,
          confirmPassword: next.newPassword !== next.confirmPassword ? 'Les mots de passe ne correspondent pas.' : ''
        }));
      }
      return next;
    });
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    const errors = {};
    if (!passwordData.currentPassword) errors.currentPassword = 'Le mot de passe actuel est requis';
    if (!passwordData.newPassword) errors.newPassword = 'Le nouveau mot de passe est requis';
    else if (passwordData.newPassword.length < 8) errors.newPassword = 'Au moins 8 caractères requis';
    else if (passwordStrength < 3) errors.newPassword = 'Mot de passe trop faible';
    if (passwordData.newPassword !== passwordData.confirmPassword) errors.confirmPassword = 'Les mots de passe ne correspondent pas';
    if (Object.keys(errors).length > 0) { setPasswordErrors(errors); return; }
    try {
      setIsSaving(true);
      const res = await axiosAdmin.put('/api/users/change-password', {
        currentPassword: passwordData.currentPassword,
        newPassword: passwordData.newPassword
      });
      if (res.data.success) {
        toast.success('Mot de passe mis à jour');
        setShowChangePassword(false);
        setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
        setPasswordErrors({});
      }
    } catch (error) {
      const msg = error.response?.data?.error || 'Erreur lors du changement de mot de passe';
      toast.error(msg);
      if (error.response?.data?.field) {
        setPasswordErrors(pe => ({ ...pe, [error.response.data.field]: error.response.data.error }));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Veuillez sélectionner une image'); return; }
    setAvatarUploading(true);
    try {
      const compressed = await compressImage(file, { maxSizeMB: 0.05, maxWidthOrHeight: 200 });
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result;
        try {
          const res = await axiosAdmin.put('/api/users/avatar', { avatar: base64 });
          if (res.data.success) {
            setAvatar(base64);
            window.dispatchEvent(new CustomEvent('avatarUpdated', { detail: base64 }));
            toast.success('Photo de profil mise à jour');
          }
        } catch (err) {
          toast.error(err.response?.data?.error || 'Erreur lors de l\'upload');
        } finally {
          setAvatarUploading(false);
        }
      };
      reader.readAsDataURL(compressed);
    } catch {
      toast.error('Erreur lors de la compression');
      setAvatarUploading(false);
    }
  };

  const handleRemoveAvatar = async () => {
    try {
      setAvatarUploading(true);
      await axiosAdmin.put('/api/users/avatar', { avatar: null });
      setAvatar(null);
      window.dispatchEvent(new CustomEvent('avatarUpdated', { detail: null }));
      toast.success('Photo de profil supprimée');
    } catch { toast.error('Erreur lors de la suppression'); }
    finally { setAvatarUploading(false); }
  };

  const handleTogglePush = async () => {
    setPushLoading(true);
    try {
      const apiUrl = window._env_?.REACT_APP_API_URL || process.env.REACT_APP_API_URL || '';
      if (pushSubscribed) {
        await unsubscribeFromPush(apiUrl);
        setPushSubscribed(false);
        toast.success('Notifications push désactivées');
      } else {
        if (Notification.permission === 'denied') {
          toast.error('Notifications bloquées par le navigateur.');
          return;
        }
        await subscribeToPush(apiUrl);
        setPushSubscribed(true);
        toast.success('Notifications push activées ! 🔔');
      }
    } catch (err) {
      toast.error(err.message || 'Erreur notifications push');
    } finally {
      setPushLoading(false);
    }
  };

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    if (name.startsWith('notificationPreferences.')) {
      const [, prefKey, subKey] = name.split('.');
      setUser(prev => ({
        ...prev,
        notificationPreferences: {
          ...prev.notificationPreferences,
          [prefKey]: { ...prev.notificationPreferences?.[prefKey], [subKey]: type === 'checkbox' ? checked : value }
        }
      }));
    } else {
      setUser(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const response = await axiosAdmin.put('/api/users/profile', {
        email: user.email,
        notificationPreferences: user.notificationPreferences
      });
      if (response.data.success) toast.success('Paramètres enregistrés');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Erreur lors de la mise à jour');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.loadingSpinner}></div>
        <p>Chargement...</p>
      </div>
    );
  }

  const avatarColor = getAvatarColor(user.username || '?');

  return (
    <div className={styles.pageWrapper}>
      <h1 className={styles.pageTitle}>Paramètres</h1>

      <form onSubmit={handleSubmit}>

        {/* ── Profil ── */}
        <div className={styles.settingsCard}>
          <h2 className={styles.sectionTitle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
            </svg>
            Profil
          </h2>

          {/* Avatar */}
          <div className={styles.avatarRow}>
            <div className={styles.avatarWrap}>
              {avatar
                ? <img src={avatar} alt="Avatar" className={styles.avatarImg} />
                : <span className={styles.avatarLetter} style={{ background: avatarColor }}>{(user.username || '?')[0].toUpperCase()}</span>
              }
              {avatarUploading && <div className={styles.avatarOverlay}><div className={styles.avatarSpinner} /></div>}
            </div>
            <div className={styles.avatarMeta}>
              <p className={styles.avatarName}>{user.username}</p>
              <div className={styles.avatarBtns}>
                <input ref={avatarInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarChange} />
                <button type="button" className={styles.btnOutline} onClick={() => avatarInputRef.current?.click()} disabled={avatarUploading}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  {avatar ? 'Changer' : 'Ajouter une photo'}
                </button>
                {avatar && (
                  <button type="button" className={styles.btnDanger} onClick={handleRemoveAvatar} disabled={avatarUploading}>Supprimer</button>
                )}
              </div>
            </div>
          </div>

          <div className={styles.divider} />

          {/* Username */}
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel}>Nom d'utilisateur</label>
            <input type="text" value={user.username} disabled className={`${styles.fieldInput} ${styles.fieldInputDisabled}`} />
          </div>

          {/* Email */}
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel}>Adresse email</label>
            <div className={styles.fieldInputWrap}>
              <input
                type="email"
                name="email"
                value={user.email || ''}
                onChange={handleInputChange}
                className={styles.fieldInput}
                placeholder="votre@email.com"
              />
              {user.email && !user.emailVerified && (
                <span className={styles.emailBadgeWarn}>⚠ Non vérifié</span>
              )}
              {user.email && user.emailVerified && (
                <span className={styles.emailBadgeOk}>✓ Vérifié</span>
              )}
            </div>
          </div>

          <div className={styles.cardActions}>
            <button type="submit" className={styles.btnPrimary} disabled={isSaving}>
              {isSaving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </div>

        {/* ── Notifications ── */}
        <div className={styles.settingsCard}>
          <h2 className={styles.sectionTitle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            Notifications
          </h2>

          <div className={styles.toggleRow}>
            <div className={styles.toggleInfo}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.toggleIcon}>
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
              </svg>
              <div>
                <p className={styles.toggleLabel}>Notifications par email</p>
                <p className={styles.toggleDesc}>Reçois un email quand un livre est prêt</p>
              </div>
            </div>
            <label className={styles.switch}>
              <input
                type="checkbox"
                name="notificationPreferences.email.enabled"
                checked={user.notificationPreferences.email.enabled}
                onChange={handleInputChange}
              />
              <span className={styles.slider} />
            </label>
          </div>

          <div className={styles.toggleRow}>
            <div className={styles.toggleInfo}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.toggleIcon}>
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
              <div>
                <p className={styles.toggleLabel}>Notifications sur le site</p>
                <p className={styles.toggleDesc}>Bandeau de notification dans l'application</p>
              </div>
            </div>
            <label className={styles.switch}>
              <input
                type="checkbox"
                name="notificationPreferences.push.enabled"
                checked={user.notificationPreferences.push.enabled}
                onChange={handleInputChange}
              />
              <span className={styles.slider} />
            </label>
          </div>

          {pushSupported && (
            <div className={styles.toggleRow}>
              <div className={styles.toggleInfo}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.toggleIcon}>
                  <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>
                </svg>
                <div>
                  <p className={styles.toggleLabel}>Notifications push</p>
                  <p className={styles.toggleDesc}>Reçois des notifications même quand l'app est fermée</p>
                </div>
              </div>
              <label className={`${styles.switch} ${pushLoading ? styles.switchDisabled : ''}`}>
                <input
                  type="checkbox"
                  checked={pushSubscribed}
                  onChange={handleTogglePush}
                  disabled={pushLoading}
                />
                <span className={styles.slider} />
              </label>
            </div>
          )}
        </div>

        {/* ── Sécurité ── */}
        <div className={styles.settingsCard}>
          <h2 className={styles.sectionTitle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            Sécurité
          </h2>

          <div className={styles.toggleRow} style={{ cursor: 'pointer' }} onClick={() => setShowChangePassword(v => !v)}>
            <div className={styles.toggleInfo}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.toggleIcon}>
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
              <div>
                <p className={styles.toggleLabel}>Mot de passe</p>
                <p className={styles.toggleDesc}>Modifier votre mot de passe</p>
              </div>
            </div>
            <svg
              width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"
              style={{ color: 'var(--color-text-muted)', transition: 'transform 0.2s', transform: showChangePassword ? 'rotate(180deg)' : 'none', flexShrink: 0 }}
            >
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </div>

          {showChangePassword && (
            <div className={styles.passwordPanel}>
              <p className={styles.passwordHint}>
                Utilisez un mot de passe fort avec majuscules, chiffres et caractères spéciaux.
              </p>

              {[
                { id: 'currentPassword', label: 'Mot de passe actuel', placeholder: 'Mot de passe actuel' },
                { id: 'newPassword', label: 'Nouveau mot de passe', placeholder: 'Nouveau mot de passe' },
                { id: 'confirmPassword', label: 'Confirmer', placeholder: 'Confirmer le nouveau mot de passe' }
              ].map(({ id, label, placeholder }) => (
                <div className={styles.fieldRow} key={id}>
                  <label className={styles.fieldLabel}>{label}</label>
                  <input
                    type="password"
                    id={id}
                    name={id}
                    value={passwordData[id]}
                    onChange={handlePasswordChange}
                    className={`${styles.fieldInput} ${passwordErrors[id] ? styles.fieldInputError : ''}`}
                    placeholder={placeholder}
                  />
                  {id === 'newPassword' && passwordData.newPassword && (
                    <div className={styles.strengthWrap}>
                      <div className={styles.strengthTrack}>
                        <div
                          className={`${styles.strengthBar} ${passwordStrength < 2 ? styles.weak : passwordStrength < 4 ? styles.medium : styles.strong}`}
                          style={{ width: `${(passwordStrength / 5) * 100}%` }}
                        />
                      </div>
                      <span className={styles.strengthText}>
                        {passwordStrength < 2 ? 'Faible' : passwordStrength < 4 ? 'Moyen' : 'Fort'}
                      </span>
                    </div>
                  )}
                  {passwordErrors[id] && <p className={styles.fieldError}>{passwordErrors[id]}</p>}
                </div>
              ))}

              <div className={styles.cardActions}>
                <button type="button" className={styles.btnPrimary} onClick={handlePasswordSubmit} disabled={isSaving}>
                  {isSaving ? 'Enregistrement...' : 'Mettre à jour le mot de passe'}
                </button>
              </div>
            </div>
          )}
        </div>

      </form>
    </div>
  );
};

export default UserSettings;