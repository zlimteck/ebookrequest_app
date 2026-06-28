import React, { useState, useEffect, useRef } from 'react';
import { toast } from 'react-toastify';
import axiosAdmin from '../axiosAdmin';
import styles from './UserSettings.module.css';
import { useTheme } from '../context/ThemeContext';
import { compressImage } from '../utils/imageCompressor';
import { subscribeToPush, unsubscribeFromPush, isPushSubscribed } from '../serviceWorkerRegistration';
import TwoFactorSetup from './TwoFactorSetup';
import { startRegistration } from '@simplewebauthn/browser';

import { getAvatarColor } from '../utils/avatarColor';

const THEME_OPTIONS = [
  {
    key: 'dark', label: 'Sombre',
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
  },
  {
    key: 'light', label: 'Clair',
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>,
  },
  {
    key: 'auto', label: 'Auto', desc: 'Système',
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>,
  },
];

const UserSettings = () => {
  const { theme, setTheme } = useTheme();
  const [user, setUser] = useState({
    email: '',
    username: '',
    notificationPreferences: {
      email: { enabled: false, bookCompleted: true, bookCanceled: true, adminComment: true },
      push: { enabled: true }
    }
  });
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [passkeys, setPasskeys] = useState([]);
  const [passkeyRegistering, setPasskeyRegistering] = useState(false);
  const [passkeyNameInput, setPasskeyNameInput] = useState('');
  const [passkeyShowNameForm, setPasskeyShowNameForm] = useState(false);
  const [passkeyConfirmDelete, setPasskeyConfirmDelete] = useState(null); // credentialID en attente de confirmation
  const [passkeyDeleting, setPasskeyDeleting] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionRevoking, setSessionRevoking] = useState(null);
  const [sessionConfirmRevoke, setSessionConfirmRevoke] = useState(null);
  const [sessionConfirmRevokeAll, setSessionConfirmRevokeAll] = useState(false);
  const [sessionsPage, setSessionsPage] = useState(1);
  const SESSIONS_PER_PAGE = 5;
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

  const [opdsUrl, setOpdsUrl] = useState('');
  const [opdsLoading, setOpdsLoading] = useState(false);

  const [calibre, setCalibre] = useState({
    enabled: false,
    url: '',
    username: '',
    password: '',
    hasPassword: false,
    shelfName: '',
    lastSync: null,
  });

  const [appriseGlobalEnabled, setAppriseGlobalEnabled] = useState(false);
  const [apprisePrefs, setApprisePrefs] = useState({
    enabled: false,
    urls: '',
    notifyOnComplete: true,
    notifyOnCancel: true,
    notifyOnAdminComment: true,
  });
  const [appriseSaving, setAppriseSaving] = useState(false);
  const [appriseTesting, setAppriseTesting] = useState(false);
  const [appriseTestResult, setAppriseTestResult] = useState(null);
  const [calibreSaving, setCalibreSaving] = useState(false);
  const [calibreTesting, setCalibreTesting] = useState(false);
  const [calibreTestResult, setCalibreTestResult] = useState(null);
  const [calibreSyncing, setCalibreSyncing] = useState(false);
  const [calibreSyncResult, setCalibreSyncResult] = useState(null);

  const [valentine, setValentine] = useState({ username: '', password: '', hasPassword: false });
  const [valentineSaving, setValentineSaving] = useState(false);
  const [valentineTesting, setValentineTesting] = useState(false);
  const [valentineTestResult, setValentineTestResult] = useState(null);
  const [valentineQuota, setValentineQuota] = useState(null);
  const [valentineQuotaFetchedAt, setValentineQuotaFetchedAt] = useState(null);

  const [mcpInfo, setMcpInfo] = useState(null);
  const [tokenVisible, setTokenVisible] = useState(false);

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const response = await axiosAdmin.get('/api/users/me');
        if (response.data.success) {
          const u = response.data.user;
          setUser(prev => ({
            ...prev,
            ...u,
            notificationPreferences: {
              email: {
                enabled:       u.notificationPreferences?.email?.enabled || false,
                bookCompleted: u.notificationPreferences?.email?.bookCompleted !== false,
                bookCanceled:  u.notificationPreferences?.email?.bookCanceled  !== false,
                adminComment:  u.notificationPreferences?.email?.adminComment  !== false,
              },
              push: { enabled: u.notificationPreferences?.push?.enabled !== false }
            }
          }));
          if (u.avatar) setAvatar(u.avatar);
          setTwoFactorEnabled(u.twoFactor?.enabled || false);
          if (u.notificationPreferences?.apprise) {
            setApprisePrefs(prev => ({ ...prev, ...u.notificationPreferences.apprise }));
          }
        }
      } catch (error) {
        toast.error('Erreur lors du chargement de votre profil');
      } finally {
        setIsLoading(false);
      }
    };
    const fetchOpdsToken = async () => {
      try {
        const res = await axiosAdmin.get('/api/users/opds-token');
        if (res.data.success) setOpdsUrl(res.data.feedUrl);
      } catch {
        // silencieux — l'utilisateur peut cliquer sur le bouton pour générer
      }
    };
    const fetchCalibreConfig = async () => {
      try {
        const res = await axiosAdmin.get('/api/users/calibre');
        setCalibre(prev => ({ ...prev, ...res.data, password: '' }));
      } catch {
        // silencieux
      }
    };
    const fetchAppriseStatus = async () => {
      try {
        const res = await axiosAdmin.get('/api/apprise/status');
        setAppriseGlobalEnabled(res.data.enabled || false);
      } catch { /* silencieux */ }
    };
    const fetchValentineConfig = async () => {
      try {
        const res = await axiosAdmin.get('/api/users/valentine');
        const username = res.data.username || '';
        const hasPassword = res.data.hasPassword || false;
        setValentine(prev => ({ ...prev, username, hasPassword }));
        localStorage.setItem('hasValentine', hasPassword ? 'true' : 'false');
        // Auto-fetch quota si des identifiants sont enregistrés
        if (hasPassword) {
          try {
            const qRes = await axiosAdmin.get('/api/users/valentine/quota');
            setValentineQuota(qRes.data);
            setValentineQuotaFetchedAt(new Date());
          } catch { /* silencieux */ }
        }
      } catch { /* silencieux */ }
    };
    const fetchMcpInfo = async () => {
      try {
        const res = await axiosAdmin.get('/api/mcp/info');
        setMcpInfo(res.data);
      } catch { /* silencieux */ }
    };
    const fetchPasskeys = async () => {
      try {
        const res = await axiosAdmin.get('/api/auth/passkey/list');
        setPasskeys(res.data || []);
      } catch { /* silencieux */ }
    };
    fetchUserData();
    fetchOpdsToken();
    fetchCalibreConfig();
    fetchAppriseStatus();
    fetchValentineConfig();
    fetchMcpInfo();
    fetchPasskeys();
    fetchSessions();
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
      const val = type === 'checkbox' ? checked : value;
      setUser(prev => {
        const updatedPrefKey = { ...prev.notificationPreferences?.[prefKey], [subKey]: val };
        if (prefKey === 'email') handleSaveEmailPrefs(updatedPrefKey);
        return {
          ...prev,
          notificationPreferences: {
            ...prev.notificationPreferences,
            [prefKey]: updatedPrefKey,
          }
        };
      });
    } else {
      setUser(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    }
  };

  const handleRegenerateOpds = async () => {
    if (!window.confirm('Régénérer le token ? L\'ancien token ne fonctionnera plus dans vos liseuses, raccourcis, et intégrations MCP.')) return;
    setOpdsLoading(true);
    try {
      const res = await axiosAdmin.post('/api/users/opds-token/regenerate');
      if (res.data.success) {
        setOpdsUrl(res.data.feedUrl);
        toast.success('Token régénéré');
      }
    } catch {
      toast.error('Erreur lors de la régénération du lien');
    } finally {
      setOpdsLoading(false);
    }
  };

  // Les name attrs des champs Calibre utilisent des préfixes non-standards
  // pour éviter l'autofill Safari (qui détecte "username"/"password" même hors <form>)
  const CALIBRE_FIELD_MAP = { 'cweb-url': 'url', 'cweb-user': 'username', 'cweb-pass': 'password', 'cweb-shelf': 'shelfName' };
  const handleCalibreChange = (e) => {
    const { name, value, type, checked } = e.target;
    const key = CALIBRE_FIELD_MAP[name] ?? name;
    setCalibre(prev => ({ ...prev, [key]: type === 'checkbox' ? checked : value }));
    setCalibreTestResult(null);
  };

  const handleCalibreTest = async () => {
    setCalibreTesting(true);
    setCalibreTestResult(null);
    try {
      const res = await axiosAdmin.post('/api/users/calibre/test', {
        url: calibre.url,
        username: calibre.username,
        password: calibre.password,
      });
      setCalibreTestResult(res.data);
    } catch (err) {
      setCalibreTestResult({ connected: false, error: err.response?.data?.error || err.message });
    } finally {
      setCalibreTesting(false);
    }
  };

  const handleCalibreSave = async () => {
    setCalibreSaving(true);
    try {
      await axiosAdmin.put('/api/users/calibre', {
        enabled: calibre.enabled,
        url: calibre.url,
        username: calibre.username,
        password: calibre.password || undefined,
        shelfName: calibre.shelfName,
      });
      // Update hasApiKey/hasPassword hints without clearing fields
      setCalibre(prev => ({
        ...prev,
        hasApiKey: prev.hasApiKey || Boolean(prev.apiKey),
        hasPassword: prev.hasPassword || Boolean(prev.password),
        password: '',
      }));
      toast.success('Configuration Calibre-Web enregistrée');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la sauvegarde');
    } finally {
      setCalibreSaving(false);
    }
  };

  const handleCalibreSync = async () => {
    setCalibreSyncing(true);
    setCalibreSyncResult(null);
    try {
      const res = await axiosAdmin.post('/api/users/calibre/sync');
      setCalibreSyncResult(res.data);
      if (res.data.lastSync) {
        setCalibre(prev => ({ ...prev, lastSync: res.data.lastSync }));
      }
    } catch (err) {
      setCalibreSyncResult({ error: err.response?.data?.error || err.message });
    } finally {
      setCalibreSyncing(false);
    }
  };

  const handleValentineSave = async () => {
    setValentineSaving(true);
    setValentineTestResult(null);
    try {
      await axiosAdmin.put('/api/users/valentine', {
        username: valentine.username,
        ...(valentine.password ? { password: valentine.password } : {}),
      });
      setValentine(prev => ({ ...prev, password: '', hasPassword: !!(prev.hasPassword || prev.password) }));
      toast.success('Compte Valentine enregistré');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de la sauvegarde');
    } finally {
      setValentineSaving(false);
    }
  };

  const handleValentineTest = async () => {
    setValentineTesting(true);
    setValentineTestResult(null);
    try {
      const res = await axiosAdmin.post('/api/users/valentine/test', {
        username: valentine.username,
        password: valentine.password || '••••••••',
      });
      setValentineTestResult({ type: 'success', message: res.data.message || 'Connexion réussie !' });
    } catch (err) {
      setValentineTestResult({ type: 'error', message: err.response?.data?.error || 'Connexion impossible' });
    } finally {
      setValentineTesting(false);
    }
  };

  const handleValentineDelete = async () => {
    if (!window.confirm('Supprimer votre compte Valentine personnel ? Le compte admin sera utilisé à la place.')) return;
    try {
      await axiosAdmin.put('/api/users/valentine', { username: '', password: '' });
      setValentine({ username: '', password: '', hasPassword: false });
      setValentineQuota(null);
      localStorage.setItem('hasValentine', 'false');
      toast.success('Compte Valentine supprimé');
    } catch {
      toast.error('Erreur lors de la suppression');
    }
  };


  const handleSaveApprise = async () => {
    setAppriseSaving(true);
    try {
      await axiosAdmin.put('/api/users/profile', {
        notificationPreferences: { apprise: apprisePrefs }
      });
      toast.success('Préférences Apprise enregistrées');
    } catch {
      toast.error('Erreur lors de la sauvegarde');
    } finally {
      setAppriseSaving(false);
    }
  };

  const handleTestApprise = async () => {
    setAppriseTesting(true);
    setAppriseTestResult(null);
    try {
      const res = await axiosAdmin.post('/api/apprise/test-user');
      setAppriseTestResult({ type: 'success', message: res.data.message || 'Notification de test envoyée !' });
    } catch (err) {
      setAppriseTestResult({ type: 'error', message: err.response?.data?.message || 'Erreur lors du test' });
    } finally {
      setAppriseTesting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const response = await axiosAdmin.put('/api/users/profile', { email: user.email });
      if (response.data.success) toast.success('Adresse email mise à jour');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Erreur lors de la mise à jour');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveEmailPrefs = async (updatedPrefs) => {
    try {
      await axiosAdmin.put('/api/users/profile', {
        notificationPreferences: { email: updatedPrefs }
      });
    } catch {
      toast.error('Erreur lors de la sauvegarde');
    }
  };

  // ── Passkey handlers ──────────────────────────────────────────────────────
  const handleAddPasskey = async () => {
    const name = passkeyNameInput.trim() || 'Ma Passkey';
    setPasskeyRegistering(true);
    try {
      const optRes = await axiosAdmin.post('/api/auth/passkey/register-options', {});
      let regResponse;
      try {
        regResponse = await startRegistration({ optionsJSON: optRes.data });
      } catch (err) {
        if (err.name !== 'NotAllowedError') {
          toast.error('Passkey non disponible ou annulée.');
        }
        return;
      }
      const verifyRes = await axiosAdmin.post('/api/auth/passkey/register-verify', {
        response: regResponse,
        name,
      }, { validateStatus: s => s < 500 });
      if (verifyRes.data.success) {
        setPasskeys(prev => [...prev, verifyRes.data.passkey]);
        setPasskeyShowNameForm(false);
        setPasskeyNameInput('');
        toast.success('Passkey enregistrée avec succès.');
      } else {
        toast.error(verifyRes.data.error || 'Erreur lors de l\'enregistrement.');
      }
    } catch {
      toast.error('Impossible d\'enregistrer la passkey.');
    } finally {
      setPasskeyRegistering(false);
    }
  };

  const handleDeletePasskey = async (credentialID) => {
    setPasskeyDeleting(credentialID);
    try {
      await axiosAdmin.delete(`/api/auth/passkey/${encodeURIComponent(credentialID)}`);
      setPasskeys(prev => prev.filter(pk => pk.credentialID !== credentialID));
      setPasskeyConfirmDelete(null);
      toast.success('Passkey supprimée.');
    } catch {
      toast.error('Erreur lors de la suppression.');
    } finally {
      setPasskeyDeleting(null);
    }
  };

  // ── Session handlers ──────────────────────────────────────────────────────
  const fetchSessions = async () => {
    setSessionsLoading(true);
    try {
      const res = await axiosAdmin.get('/api/sessions');
      const data = res.data || [];
      setSessions([...data.filter(s => s.isCurrent), ...data.filter(s => !s.isCurrent)]);
      setSessionsPage(1);
    } catch {
      toast.error('Impossible de charger les sessions.');
    } finally {
      setSessionsLoading(false);
    }
  };

  const handleRevokeSession = async (id) => {
    setSessionRevoking(id);
    try {
      await axiosAdmin.delete(`/api/sessions/${id}`);
      setSessions(prev => prev.filter(s => s.id !== id));
      setSessionConfirmRevoke(null);
      toast.success('Session révoquée.');
    } catch {
      toast.error('Impossible de révoquer la session.');
    } finally {
      setSessionRevoking(null);
    }
  };

  const handleRevokeAllSessions = async () => {
    setSessionRevoking('all');
    try {
      await axiosAdmin.delete('/api/sessions');
      setSessions(prev => prev.filter(s => s.isCurrent));
      toast.success('Toutes les autres sessions ont été révoquées.');
    } catch {
      toast.error('Impossible de révoquer les sessions.');
    } finally {
      setSessionRevoking(null);
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

  const avatarColor = getAvatarColor({ role: user.role, hasValentine: !!(valentine.hasPassword || valentine.username) });

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

        {/* ── Apparence ── */}
        <div className={styles.settingsCard}>
          <h2 className={styles.sectionTitle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
            </svg>
            Apparence
          </h2>
          <p className={styles.fieldDesc}>Choisissez le thème de l'interface.</p>
          <div className={styles.themeOptions}>
            {THEME_OPTIONS.map(opt => (
              <button
                key={opt.key}
                type="button"
                className={`${styles.themeOption} ${theme === opt.key ? styles.themeOptionActive : ''}`}
                onClick={() => setTheme(opt.key)}
              >
                <span className={styles.themeOptionIcon}>{opt.icon}</span>
                <span className={styles.themeOptionLabel}>
                  {opt.label}{opt.desc && <span className={styles.themeOptionDesc}> — {opt.desc}</span>}
                </span>
              </button>
            ))}
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

          <div className={styles.toggleRow} style={user.notificationPreferences.email.enabled ? { alignItems: 'flex-start' } : {}}>
            <div className={styles.toggleInfo} style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.toggleIcon} style={{ flexShrink: 0 }}>
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
                </svg>
                <div>
                  <p className={styles.toggleLabel}>Notifications par email</p>
                  <p className={styles.toggleDesc}>Reçois un email pour les événements sélectionnés</p>
                </div>
              </div>
              {user.notificationPreferences.email.enabled && (
                <div style={{ marginTop: '0.65rem', paddingLeft: '1.85rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {[
                    { name: 'notificationPreferences.email.bookCompleted', label: 'Livre disponible au téléchargement' },
                    { name: 'notificationPreferences.email.bookCanceled',  label: 'Demande annulée' },
                    { name: 'notificationPreferences.email.adminComment',  label: 'Commentaire d\'un administrateur' },
                  ].map(ev => (
                    <label key={ev.name} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        name={ev.name}
                        checked={!!user.notificationPreferences.email[ev.name.split('.')[2]]}
                        onChange={handleInputChange}
                        style={{ accentColor: 'var(--color-accent)', width: 14, height: 14, flexShrink: 0 }}
                      />
                      <span style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)' }}>{ev.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <label className={styles.switch} style={{ marginTop: '0.15rem', flexShrink: 0 }}>
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

      </form>

      {/* ── Apprise personnel (hors <form> pour éviter le bug de focus Safari) ── */}
      {localStorage.getItem('role') !== 'admin' && appriseGlobalEnabled ? (
        <div className={styles.settingsCard}>
          <h2 className={styles.sectionTitle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            Notifications Apprise
          </h2>

          {/* Toggle activation */}
          <div className={styles.toggleRow}>
            <div className={styles.toggleInfo}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.toggleIcon}>
                <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>
              </svg>
              <div>
                <p className={styles.toggleLabel}>Activer les notifications Apprise</p>
                <p className={styles.toggleDesc}>Reçois tes notifications via Pushover, Discord, Telegram…</p>
              </div>
            </div>
            <label className={styles.switch}>
              <input type="checkbox" checked={apprisePrefs.enabled}
                onChange={async e => {
                  const updated = { ...apprisePrefs, enabled: e.target.checked };
                  setApprisePrefs(updated);
                  try { await axiosAdmin.put('/api/users/profile', { notificationPreferences: { apprise: updated } }); } catch { /* silencieux */ }
                }} />
              <span className={styles.slider} />
            </label>
          </div>

          {apprisePrefs.enabled && (<>
            {/* URLs personnelles */}
            <div style={{ marginTop: '1rem' }}>
              <label className={styles.fieldLabel}>
                Tes URLs Apprise <span style={{ opacity: 0.5, fontWeight: 400 }}>(une par ligne)</span>
              </label>
              <textarea
                className={styles.fieldTextarea || styles.fieldInput}
                rows={3}
                placeholder={'pover://userKey@apiToken\ndiscord://webhook_id/webhook_token'}
                value={apprisePrefs.urls}
                onChange={e => setApprisePrefs(p => ({ ...p, urls: e.target.value }))}
                spellCheck={false}
                style={{ fontFamily: 'monospace', fontSize: '0.82rem', resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
              />
              <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', margin: '0.35rem 0 0' }}>
                Voir la <a href="https://github.com/caronc/apprise/wiki" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-accent)' }}>documentation Apprise</a> pour les formats d'URL.
              </p>
            </div>

            {/* Événements */}
            <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border)' }}>
              <p style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 0.6rem' }}>
                Événements
              </p>
              {[
                { key: 'notifyOnComplete',     label: 'Livre disponible au téléchargement' },
                { key: 'notifyOnCancel',        label: 'Demande annulée' },
                { key: 'notifyOnAdminComment',  label: 'Commentaire d\'un administrateur' },
              ].map(ev => (
                <label key={ev.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.45rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={!!apprisePrefs[ev.key]}
                    onChange={async e => {
                      const updated = { ...apprisePrefs, [ev.key]: e.target.checked };
                      setApprisePrefs(updated);
                      try { await axiosAdmin.put('/api/users/profile', { notificationPreferences: { apprise: updated } }); } catch { /* silencieux */ }
                    }}
                    style={{ accentColor: 'var(--color-accent)', width: 15, height: 15, flexShrink: 0 }} />
                  <span style={{ fontSize: '0.855rem', color: 'var(--color-text)' }}>{ev.label}</span>
                </label>
              ))}
            </div>
          </>)}

          <div className={styles.cardActions} style={{ marginTop: '1rem' }}>
            {apprisePrefs.enabled && apprisePrefs.urls?.trim() && (
              <button type="button" className={styles.btnOutline} onClick={handleTestApprise} disabled={appriseTesting}>
                {appriseTesting ? 'Envoi…' : 'Tester'}
              </button>
            )}
            <button type="button" className={styles.btnPrimary} onClick={handleSaveApprise} disabled={appriseSaving}>
              {appriseSaving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
          {appriseTestResult && (
            <div className={`${styles.alert} ${appriseTestResult.type === 'success' ? styles.alertSuccess : styles.alertError}`}>
              {appriseTestResult.type === 'success'
                ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              }
              {appriseTestResult.message}
            </div>
          )}
        </div>
      ) : localStorage.getItem('role') !== 'admin' ? (
        <div className={styles.settingsCard}>
          <h2 className={styles.sectionTitle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            Notifications Apprise
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', margin: 0 }}>
            Apprise n'est pas activé sur cette instance. Contactez votre administrateur.
          </p>
        </div>
      ) : null}

        {/* ── Valentine ── */}
        {localStorage.getItem('role') !== 'admin' && (
          <div className={styles.settingsCard}>
            <h2 className={styles.sectionTitle}>
              <img src="https://valentine.wtf/logo.php?mode=clair" alt="Valentine" style={{ height: '16px', width: 'auto' }} />
              Compte Valentine
            </h2>
            <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', margin: '0 0 1rem' }}>
              Utilisez votre propre compte <a href="https://valentine.wtf" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-accent)' }}>valentine.wtf</a> pour les téléchargements automatiques. Sans compte personnel, le compte administrateur est utilisé.
            </p>
            {valentineQuota && !valentineQuota.error && (
              <div className={styles.valentineQuotaBar}>
                <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="8 17 12 21 16 17"/><line x1="12" y1="3" x2="12" y2="21"/>
                </svg>
                Quota : <strong>{valentineQuota.remaining ?? '—'}</strong>
                {valentineQuota.total != null && <span>/ {valentineQuota.total} restants</span>}
              </div>
            )}
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel}>Identifiant</label>
              <input
                type="text"
                className={styles.fieldInput}
                autoComplete="off"
                value={valentine.username}
                onChange={e => { setValentine(p => ({ ...p, username: e.target.value })); setValentineTestResult(null); }}
                placeholder="Votre identifiant valentine.wtf"
              />
            </div>
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel}>Mot de passe</label>
              <input
                type="password"
                className={styles.fieldInput}
                autoComplete="new-password"
                value={valentine.password}
                onChange={e => { setValentine(p => ({ ...p, password: e.target.value })); setValentineTestResult(null); }}
                placeholder={valentine.hasPassword ? '••••••••' : 'Mot de passe'}
              />
            </div>
            <div className={styles.cardActions}>
              {(valentine.username || valentine.hasPassword) && (
                <button type="button" className={styles.btnOutline} onClick={handleValentineTest} disabled={valentineTesting}>
                  {valentineTesting ? 'Test…' : 'Tester'}
                </button>
              )}
              <button type="button" className={styles.btnPrimary} onClick={handleValentineSave} disabled={valentineSaving}>
                {valentineSaving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
              {valentine.hasPassword && (
                <button type="button" className={styles.btnDanger} onClick={handleValentineDelete}>
                  Supprimer
                </button>
              )}
            </div>
            {valentineTestResult && (
              <div className={`${styles.alert} ${valentineTestResult.type === 'success' ? styles.alertSuccess : styles.alertError}`}>
                {valentineTestResult.type === 'success'
                  ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                }
                {valentineTestResult.message}
              </div>
            )}
          </div>
        )}

        {/* ── Token d'accès ── */}
        <div className={styles.settingsCard}>
          <h2 className={styles.sectionTitle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
            </svg>
            Token d'accès
          </h2>
          <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
            Token personnel utilisé pour OPDS, MCP et l'API REST.
          </p>
          {(() => {
            const token = opdsUrl ? opdsUrl.substring(opdsUrl.lastIndexOf('/') + 1) : '';
            const copyToken = () => { navigator.clipboard.writeText(token); toast.success('Token copié !'); };
            return (
              <div className={styles.fieldRow} style={{ marginBottom: '0.5rem' }}>
                <label className={styles.fieldLabel}>Token</label>
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  <input readOnly value={token || 'Chargement…'} type={tokenVisible ? 'text' : 'password'}
                    className={`${styles.fieldInput} ${styles.fieldInputDisabled}`}
                    style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.78rem' }}
                    onFocus={e => e.target.select()} />
                  <button type="button" className={styles.btnOutline} onClick={() => setTokenVisible(v => !v)}
                    style={{ padding: '0.4rem 0.6rem', flexShrink: 0 }} title={tokenVisible ? 'Masquer' : 'Afficher'}>
                    {tokenVisible
                      ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    }
                  </button>
                  <button type="button" className={styles.btnOutline} disabled={!token} onClick={copyToken}
                    style={{ padding: '0.4rem 0.6rem', flexShrink: 0 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                  </button>
                </div>
              </div>
            );
          })()}
          <div className={styles.btnRowEnd}>
            <button type="button" className={styles.btnOutline} onClick={handleRegenerateOpds} disabled={opdsLoading}>
              {opdsLoading ? 'Régénération…' : 'Régénérer le token'}
            </button>
          </div>
        </div>

        {/* ── Catalogue OPDS ── */}
        <div className={styles.settingsCard}>
          <h2 className={styles.sectionTitle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
            </svg>
            Catalogue OPDS
          </h2>

          <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
            Accédez à vos livres depuis votre liseuse. Utilisez les identifiants ci-dessous dans Panels, Kobo ou KOReader.
          </p>

          {/* Infos de connexion style Panels */}
          {(() => {
            const baseOpdsUrl = opdsUrl ? opdsUrl.substring(0, opdsUrl.lastIndexOf('/')) : '';
            const opdsToken = opdsUrl ? opdsUrl.substring(opdsUrl.lastIndexOf('/') + 1) : '';
            let opdsPort = '';
            try {
              const parsed = new URL(opdsUrl);
              opdsPort = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
            } catch { opdsPort = '80'; }
            const copyField = (val, label) => {
              navigator.clipboard.writeText(val);
              toast.success(`${label} copié !`);
            };
            const CopyBtn = ({ val, label }) => (
              <button type="button" className={styles.btnOutline} disabled={!val} onClick={() => copyField(val, label)}
                style={{ padding: '0.4rem 0.6rem', flexShrink: 0 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
              </button>
            );
            const EyeBtn = () => (
              <button type="button" className={styles.btnOutline} onClick={() => setTokenVisible(v => !v)}
                style={{ padding: '0.4rem 0.6rem', flexShrink: 0 }} title={tokenVisible ? 'Masquer' : 'Afficher'}>
                {tokenVisible
                  ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                }
              </button>
            );
            const FieldRow = ({ label, value, mono, password }) => (
              <div className={styles.fieldRow} style={{ marginBottom: '0.5rem' }}>
                <label className={styles.fieldLabel}>{label}</label>
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  <input readOnly value={value || 'Chargement…'} type={password && !tokenVisible ? 'password' : 'text'}
                    className={`${styles.fieldInput} ${styles.fieldInputDisabled}`}
                    style={{ flex: 1, fontFamily: mono ? 'monospace' : undefined, fontSize: mono ? '0.78rem' : undefined }}
                    onFocus={e => e.target.select()} />
                  {password && <EyeBtn />}
                  <CopyBtn val={value} label={label} />
                </div>
              </div>
            );
            return (
              <>
                <FieldRow label="Hôte" value={baseOpdsUrl} mono />
                <FieldRow label="Port" value={opdsPort} />
                <p style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', margin: '0.25rem 0 0.75rem' }}>
                  Le nom d'utilisateur peut être n'importe quoi. Le mot de passe est votre token d'accès (voir ci-dessus).
                </p>
                {/* URL directe pour Calibre / apps sans Basic Auth */}
                <details style={{ marginTop: '0.5rem' }}>
                  <summary style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', cursor: 'pointer', userSelect: 'none' }}>
                    URL directe (Calibre, applications sans authentification)
                  </summary>
                  <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', marginTop: '0.5rem' }}>
                    <input readOnly value={opdsUrl || 'Chargement…'} className={`${styles.fieldInput} ${styles.fieldInputDisabled}`}
                      style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.78rem' }}
                      onFocus={e => e.target.select()} />
                    <CopyBtn val={opdsUrl} label="URL" />
                  </div>
                </details>
              </>
            );
          })()}

        </div>

        {/* ── MCP ── */}
        {mcpInfo && mcpInfo.configured && (() => {
          const opdsToken = opdsUrl ? opdsUrl.substring(opdsUrl.lastIndexOf('/') + 1) : '';
          const copyField = (val, label) => { navigator.clipboard.writeText(val); toast.success(`${label} copié !`); };
          const CopyBtn = ({ val, label }) => (
            <button type="button" className={styles.btnOutline} disabled={!val} onClick={() => copyField(val, label)}
              style={{ padding: '0.4rem 0.6rem', flexShrink: 0 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
          );
          const FieldRow = ({ label, value }) => (
            <div className={styles.fieldRow} style={{ marginBottom: '0.5rem' }}>
              <label className={styles.fieldLabel}>{label}</label>
              <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                <input readOnly value={value || '—'} className={`${styles.fieldInput} ${styles.fieldInputDisabled}`}
                  style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.78rem' }} onFocus={e => e.target.select()} />
                <CopyBtn val={value} label={label} />
              </div>
            </div>
          );
          return (
            <div className={styles.settingsCard}>
              <h2 className={styles.sectionTitle}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
                </svg>
                Intégration MCP
              </h2>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                <span style={{ position: 'relative', display: 'inline-flex', width: 10, height: 10, flexShrink: 0 }}>
                  {mcpInfo.online && (
                    <span style={{
                      position: 'absolute', inset: 0, borderRadius: '50%',
                      background: '#22c55e', opacity: 0.6,
                      animation: 'mcp-ping 1.4s cubic-bezier(0,0,0.2,1) infinite',
                    }} />
                  )}
                  <span style={{
                    position: 'relative', display: 'inline-flex', width: 10, height: 10,
                    borderRadius: '50%',
                    background: mcpInfo.online ? '#22c55e' : 'var(--color-error, #ef4444)',
                  }} />
                </span>
                <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                  {mcpInfo.online ? 'En ligne' : 'Hors ligne'} — Gérez vos demandes depuis n'importe quel client compatible MCP
                </span>
              </div>
              <style>{`@keyframes mcp-ping { 75%,100% { transform: scale(2); opacity: 0; } }`}</style>

              <FieldRow label="URL du serveur" value={mcpInfo.url} />

              <details style={{ marginTop: '0.75rem' }}>
                <summary style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', cursor: 'pointer', userSelect: 'none', marginBottom: '0.5rem' }}>
                  Instructions de connexion
                </summary>
                <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', lineHeight: 1.6, marginTop: '0.5rem' }}>
                  <p style={{ margin: '0 0 0.4rem', fontWeight: 500, color: 'var(--color-text)' }}>OpenWebUI / ChatMCP / Claude Web</p>
                  <p style={{ margin: '0 0 0.25rem' }}>Ajouter un serveur MCP → type <strong>Streamable HTTP</strong> → URL ci-dessus</p>
                  <p style={{ margin: '0 0 0.75rem' }}>Header : <code>Authorization: Bearer &lt;votre token&gt;</code></p>
                  <p style={{ margin: '0 0 0.4rem', fontWeight: 500, color: 'var(--color-text)' }}>Claude Desktop (Mac / Windows)</p>
                  <p style={{ margin: 0 }}>Paramètres → Développeur → Modifier la configuration → ajouter dans <code>mcpServers</code> : <code>"EBOOKREQUEST_TOKEN": "&lt;votre token&gt;"</code></p>
                </div>
              </details>

              {mcpInfo.tools?.user?.length > 0 && (
                <details style={{ marginTop: '0.75rem' }}>
                  <summary style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', cursor: 'pointer', userSelect: 'none' }}>
                    Outils disponibles ({(mcpInfo.tools.user.length + (mcpInfo.tools.admin?.length || 0))})
                  </summary>
                  <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    {mcpInfo.tools.user.map(t => (
                      <div key={t.name} style={{ fontSize: '0.8rem', display: 'flex', gap: '0.5rem' }}>
                        <code style={{ color: 'var(--color-accent)', minWidth: 160 }}>{t.name}</code>
                        <span style={{ color: 'var(--color-text-muted)' }}>{t.description}</span>
                      </div>
                    ))}
                    {mcpInfo.tools.admin?.map(t => (
                      <div key={t.name} style={{ fontSize: '0.8rem', display: 'flex', gap: '0.5rem' }}>
                        <code style={{ color: 'var(--color-accent)', minWidth: 160 }}>{t.name}</code>
                        <span style={{ color: 'var(--color-text-muted)' }}>{t.description} <em>(admin)</em></span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          );
        })()}

        {/* ── Calibre-Web ── */}
        <div className={styles.settingsCard}>
          <h2 className={styles.sectionTitle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
            </svg>
            Calibre-Web
          </h2>

          <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
            Envoyer automatiquement les livres complétés vers votre bibliothèque Calibre-Web.
          </p>

          {/* Toggle */}
          <div className={styles.toggleRow}>
            <div className={styles.toggleInfo}>
              <div>
                <p className={styles.toggleLabel}>Activer l'envoi automatique</p>
                <p className={styles.toggleDesc}>Les livres complétés seront envoyés vers Calibre-Web</p>
              </div>
            </div>
            <label className={styles.switch}>
              <input type="checkbox" name="enabled" checked={calibre.enabled} onChange={handleCalibreChange} />
              <span className={styles.slider} />
            </label>
          </div>

          {/* URL */}
          <div className={styles.fieldRow} style={{ marginTop: '0.75rem' }}>
            <label className={styles.fieldLabel}>URL du serveur</label>
            <input
              type="text"
              name="cweb-url"
              value={calibre.url}
              onChange={handleCalibreChange}
              className={styles.fieldInput}
              placeholder="http://192.168.1.10:8083"
              autoComplete="off"
            />
          </div>

          {/* Identifiants */}
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel}>Nom d'utilisateur</label>
            <input
              type="text"
              name="cweb-user"
              value={calibre.username}
              onChange={handleCalibreChange}
              className={styles.fieldInput}
              placeholder="admin"
              autoComplete="off"
            />
          </div>
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel}>Mot de passe</label>
            <input
              type="password"
              name="cweb-pass"
              value={calibre.password}
              onChange={handleCalibreChange}
              className={styles.fieldInput}
              placeholder={calibre.hasPassword ? '••••••••' : 'Entrez votre mot de passe'}
              autoComplete="new-password"
            />
          </div>

          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel}>
              Étagère Kobo-sync
              <span style={{ display: 'block', fontSize: '0.75rem', fontWeight: 400, color: 'var(--color-text-muted)', marginTop: '0.15rem' }}>
                Optionnel — nom exact de votre étagère Calibre-Web synchronisée avec votre Kobo
              </span>
            </label>
            <input
              type="text"
              name="cweb-shelf"
              value={calibre.shelfName}
              onChange={handleCalibreChange}
              className={styles.fieldInput}
              placeholder="ex : kobo-sync"
            />
          </div>

          {/* Test result */}
          {calibreTestResult && (
            <p style={{
              margin: '0.5rem 0 0',
              fontSize: '0.83rem',
              color: calibreTestResult.connected ? 'var(--color-success, #10b981)' : 'var(--color-danger, #ef4444)',
            }}>
              {calibreTestResult.connected
                ? '✓ Connecté avec succès'
                : `✗ ${calibreTestResult.error || 'Connexion échouée'}`}
            </p>
          )}

          <div className={styles.cardActions} style={{ gap: '0.5rem' }}>
            <button type="button" className={styles.btnOutline} onClick={handleCalibreTest} disabled={calibreTesting || !calibre.url}>
              {calibreTesting ? 'Test en cours…' : 'Tester la connexion'}
            </button>
            <button type="button" className={styles.btnPrimary} onClick={handleCalibreSave} disabled={calibreSaving}>
              {calibreSaving ? 'Enregistrement…' : 'Sauvegarder'}
            </button>
          </div>

          {calibre.enabled && (
            <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--color-border)' }}>
              <p style={{ fontSize: '0.83rem', color: 'var(--color-text-muted)', marginBottom: '0.6rem' }}>
                {calibre.lastSync ? (
                  <>
                    Synchroniser les livres complétés manquants vers Calibre-Web.
                    <span style={{ marginLeft: '0.3rem', opacity: 0.75 }}>
                      — Dernière sync : {new Date(calibre.lastSync).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })} à {new Date(calibre.lastSync).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </>
                ) : (
                  'Envoyer les livres déjà complétés (non encore synchronisés) vers Calibre-Web.'
                )}
              </p>
              <button type="button" className={styles.btnOutline} onClick={handleCalibreSync} disabled={calibreSyncing}>
                {calibreSyncing ? 'Synchronisation…' : 'Synchroniser les livres existants'}
              </button>
              {calibreSyncResult && (
                <p style={{ marginTop: '0.5rem', fontSize: '0.83rem', color: calibreSyncResult.error ? 'var(--color-danger)' : 'var(--color-success)' }}>
                  {calibreSyncResult.error
                    ? `✗ ${calibreSyncResult.error}`
                    : `✓ ${calibreSyncResult.pushed} envoyé(s)${calibreSyncResult.failed ? `, ${calibreSyncResult.failed} échoué(s)` : ''}${calibreSyncResult.skipped ? `, ${calibreSyncResult.skipped} ignoré(s) (fichier absent)` : ''} ${calibreSyncResult.message || ''}`}
                </p>
              )}
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

          {/* ── Mot de passe ── */}
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

          {/* ── Passkeys ── */}
          <div className={styles.toggleRow} style={{ cursor: 'default', alignItems: 'flex-start', flexDirection: 'column', gap: '0.75rem', borderBottom: 'none', paddingBottom: 0 }}>
            <div className={styles.toggleInfo}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.toggleIcon}>
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
              </svg>
              <div>
                <p className={styles.toggleLabel}>Passkeys</p>
                <p className={styles.toggleDesc}>Connexion sans mot de passe (biométrie, PIN)</p>
              </div>
            </div>

            {/* Liste des passkeys existantes */}
            {passkeys.length > 0 && (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {passkeys.map(pk => (
                  <div key={pk.credentialID} style={{
                    padding: '0.65rem 0.9rem',
                    background: 'var(--color-bg3)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px',
                  }}>
                    {passkeyConfirmDelete === pk.credentialID ? (
                      /* Confirmation inline de suppression */
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.85rem', color: '#ef4444' }}>
                          Supprimer «&nbsp;{pk.name}&nbsp;» ?
                        </span>
                        <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                          <button
                            type="button"
                            className={styles.btnDanger}
                            onClick={() => handleDeletePasskey(pk.credentialID)}
                            disabled={passkeyDeleting === pk.credentialID}
                            style={{ padding: '0.35rem 0.9rem', fontSize: '0.82rem' }}
                          >
                            {passkeyDeleting === pk.credentialID ? 'Suppression...' : 'Confirmer'}
                          </button>
                          <button
                            type="button"
                            className={styles.btnOutline}
                            onClick={() => setPasskeyConfirmDelete(null)}
                            style={{ padding: '0.35rem 0.9rem', fontSize: '0.82rem' }}
                          >
                            Annuler
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* Affichage normal */
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
                        <div style={{ minWidth: 0 }}>
                          <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {pk.name}
                          </span>
                          {pk.createdAt && (
                            <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                              Ajoutée le {new Date(pk.createdAt).toLocaleDateString('fr-FR')}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => setPasskeyConfirmDelete(pk.credentialID)}
                          title="Supprimer"
                          style={{
                            width: 32, height: 32, flexShrink: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            borderRadius: 'var(--radius)', border: '1px solid var(--color-border)',
                            background: 'transparent', cursor: 'pointer', color: 'var(--color-text-muted)',
                            transition: 'all 0.15s ease',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = '#ef4444'; e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-muted)'; e.currentTarget.style.background = 'transparent'; }}
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {passkeys.length === 0 && !passkeyShowNameForm && (
              <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', margin: 0 }}>
                Aucune passkey enregistrée.
              </p>
            )}

            {/* Formulaire d'ajout : saisie du nom puis déclenchement biométrie */}
            {passkeyShowNameForm ? (
              <div style={{ width: '100%' }}>
                <div className={styles.fieldRow}>
                  <label className={styles.fieldLabel}>Nom de la passkey</label>
                  <input
                    type="text"
                    className={styles.fieldInput}
                    placeholder="ex : MacBook Touch ID, iPhone Face ID…"
                    value={passkeyNameInput}
                    onChange={e => setPasskeyNameInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleAddPasskey();
                      if (e.key === 'Escape') { setPasskeyShowNameForm(false); setPasskeyNameInput(''); }
                    }}
                    maxLength={50}
                    autoFocus
                  />
                </div>
                <div className={styles.cardActions}>
                  <button
                    type="button"
                    className={styles.btnOutline}
                    onClick={() => { setPasskeyShowNameForm(false); setPasskeyNameInput(''); }}
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    className={styles.btnPrimary}
                    onClick={handleAddPasskey}
                    disabled={passkeyRegistering}
                  >
                    {passkeyRegistering ? 'Enregistrement...' : 'Enregistrer'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className={styles.btnOutline}
                onClick={() => setPasskeyShowNameForm(true)}
              >
                Ajouter une passkey
              </button>
            )}
          </div>

          <div className={styles.divider} />

          {/* ── 2FA ── */}
          <div className={styles.toggleRow} style={{ cursor: 'default', alignItems: 'flex-start', flexDirection: 'column', gap: '0.75rem', borderBottom: 'none', paddingBottom: 0 }}>
            <div className={styles.toggleInfo}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.toggleIcon}>
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
              <div>
                <p className={styles.toggleLabel}>Authentification à deux facteurs</p>
                <p className={styles.toggleDesc}>Protégez votre compte avec un code TOTP</p>
              </div>
            </div>
            <TwoFactorSetup
              is2FAEnabled={twoFactorEnabled}
              onDone={(enabled) => setTwoFactorEnabled(Boolean(enabled))}
            />
          </div>

          <div className={styles.divider} />

          {/* ── Sessions actives ── */}
          <div className={styles.toggleRow} style={{ cursor: 'default', alignItems: 'flex-start', flexDirection: 'column', gap: '0.75rem', borderBottom: 'none', paddingBottom: 0 }}>
            <div className={styles.toggleInfo}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.toggleIcon}>
                <rect x="2" y="3" width="20" height="14" rx="2"/>
                <line x1="8" y1="21" x2="16" y2="21"/>
                <line x1="12" y1="17" x2="12" y2="21"/>
              </svg>
              <div>
                <p className={styles.toggleLabel}>Sessions actives</p>
                <p className={styles.toggleDesc}>Appareils connectés à votre compte</p>
              </div>
            </div>

            {sessionsLoading && (
              <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', margin: 0 }}>Chargement...</p>
            )}

            {!sessionsLoading && sessions.length === 0 && (
              <p style={{ fontSize: '0.82rem', color: 'var(--color-text-muted)', margin: 0 }}>Aucune session active.</p>
            )}

            {!sessionsLoading && sessions.length > 0 && (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {sessions.slice((sessionsPage - 1) * SESSIONS_PER_PAGE, sessionsPage * SESSIONS_PER_PAGE).map(s => (
                  <div key={s.id} style={{
                    padding: '0.65rem 0.9rem',
                    background: 'var(--color-bg3)',
                    border: `1px solid ${s.isCurrent ? 'var(--color-accent, #a78bfa)' : 'var(--color-border)'}`,
                    borderRadius: '8px',
                  }}>
                    {sessionConfirmRevoke === s.id ? (
                      /* Confirmation inline de révocation */
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.85rem', color: '#ef4444' }}>
                          Révoquer cette session ?
                        </span>
                        <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                          <button
                            type="button"
                            className={styles.btnDanger}
                            onClick={() => { setSessionConfirmRevoke(null); handleRevokeSession(s.id); }}
                            disabled={sessionRevoking === s.id}
                            style={{ padding: '0.35rem 0.9rem', fontSize: '0.82rem' }}
                          >
                            {sessionRevoking === s.id ? 'Révocation...' : 'Confirmer'}
                          </button>
                          <button
                            type="button"
                            className={styles.btnOutline}
                            onClick={() => setSessionConfirmRevoke(null)}
                            style={{ padding: '0.35rem 0.9rem', fontSize: '0.82rem' }}
                          >
                            Annuler
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* Affichage normal */
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
                        <div style={{ minWidth: 0 }}>
                          <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--color-text)', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                            {s.browser} · {s.os}
                            {s.isCurrent && (
                              <span style={{ fontSize: '0.7rem', fontWeight: 600, color: '#fff', background: 'var(--color-accent, #a78bfa)', borderRadius: '4px', padding: '1px 6px', letterSpacing: '0.01em' }}>
                                Session courante
                              </span>
                            )}
                          </span>
                          <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', fontFamily: 'monospace', display: 'block', marginTop: '0.1rem' }}>
                            {(s.ip || '—').replace(/^::ffff:/, '')}{s.location ? ` · ${s.location}` : ''}
                          </span>
                          <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', display: 'block', marginTop: '0.1rem' }}>
                            {s.loginMethod === 'passkey' ? 'Passkey' : s.loginMethod === '2fa' ? '2FA' : s.loginMethod === 'invitation' ? 'Invitation' : 'Mot de passe'}
                            {' · '}
                            {new Date(s.lastActivity).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        {!s.isCurrent && (
                          <button
                            type="button"
                            onClick={() => setSessionConfirmRevoke(s.id)}
                            disabled={sessionRevoking === 'all'}
                            title="Révoquer"
                            style={{
                              width: 32, height: 32, flexShrink: 0,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              borderRadius: 'var(--radius)', border: '1px solid var(--color-border)',
                              background: 'transparent', cursor: 'pointer', color: 'var(--color-text-muted)',
                              transition: 'all 0.15s ease',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = '#ef4444'; e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-muted)'; e.currentTarget.style.background = 'transparent'; }}
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                              <polyline points="16 17 21 12 16 7"/>
                              <line x1="21" y1="12" x2="9" y2="12"/>
                            </svg>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {/* Pagination */}
                {sessions.length > SESSIONS_PER_PAGE && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '0.25rem' }}>
                    <button
                      type="button"
                      className={styles.btnOutline}
                      onClick={() => setSessionsPage(p => p - 1)}
                      disabled={sessionsPage === 1}
                      style={{ fontSize: '0.78rem', padding: '0.25rem 0.65rem' }}
                    >
                      ← Précédent
                    </button>
                    <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                      {sessionsPage} / {Math.ceil(sessions.length / SESSIONS_PER_PAGE)}
                    </span>
                    <button
                      type="button"
                      className={styles.btnOutline}
                      onClick={() => setSessionsPage(p => p + 1)}
                      disabled={sessionsPage >= Math.ceil(sessions.length / SESSIONS_PER_PAGE)}
                      style={{ fontSize: '0.78rem', padding: '0.25rem 0.65rem' }}
                    >
                      Suivant →
                    </button>
                  </div>
                )}

                {/* Révoquer tout — confirmation inline */}
                {sessions.filter(s => !s.isCurrent).length >= 1 && (
                  sessionConfirmRevokeAll ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.85rem', color: '#ef4444' }}>
                        Révoquer toutes les autres sessions ?
                      </span>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          type="button"
                          className={styles.btnDanger}
                          onClick={() => { setSessionConfirmRevokeAll(false); handleRevokeAllSessions(); }}
                          disabled={sessionRevoking === 'all'}
                          style={{ padding: '0.35rem 0.9rem', fontSize: '0.82rem' }}
                        >
                          {sessionRevoking === 'all' ? 'Révocation...' : 'Confirmer'}
                        </button>
                        <button
                          type="button"
                          className={styles.btnOutline}
                          onClick={() => setSessionConfirmRevokeAll(false)}
                          style={{ padding: '0.35rem 0.9rem', fontSize: '0.82rem' }}
                        >
                          Annuler
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={styles.btnOutline}
                      onClick={() => setSessionConfirmRevokeAll(true)}
                      disabled={sessionRevoking === 'all'}
                      style={{ alignSelf: 'flex-start', color: '#ef4444', borderColor: '#ef4444' }}
                    >
                      Révoquer toutes les autres sessions
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        </div>

    </div>
  );
};

export default UserSettings;