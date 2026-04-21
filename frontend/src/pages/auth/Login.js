import React, { useState, useEffect } from 'react';
import axiosAdmin from '../../axiosAdmin';
import styles from '../user/UserForm.module.css';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'react-toastify';
import { REACT_APP_API_URL } from '../../config';
import { checkAuth } from '../../services/authService';

function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [form, setForm] = useState({ username: '', password: '' });
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const verifyToken = searchParams.get('verify');

  // ── État 2FA ──
  const [step, setStep] = useState('credentials'); // 'credentials' | '2fa'
  const [tempToken, setTempToken] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [is2FALoading, setIs2FALoading] = useState(false);

  // Si un token de vérification est présent dans l'URL, on le sauvegarde
  useEffect(() => {
    if (verifyToken && verifyToken !== 'undefined') {
      localStorage.setItem('pendingEmailVerification', verifyToken);
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
      toast.info('Veuillez vous connecter pour finaliser la vérification de votre email');
    }
  }, [verifyToken]);

  // Vérifier si l'utilisateur est déjà connecté
  useEffect(() => {
    const verifyAuth = async () => {
      try {
        const { isAuthenticated, user } = await checkAuth();
        if (isAuthenticated && user) {
          const urlParams = new URLSearchParams(window.location.search);
          const verifyToken = urlParams.get('verify');
          if (verifyToken) {
            localStorage.setItem('pendingEmailVerification', verifyToken);
            window.history.replaceState({}, document.title, window.location.pathname);
          }
          const pendingVerification = localStorage.getItem('pendingEmailVerification');
          if (pendingVerification) {
            const redirectUrl = `/verify-email/${pendingVerification}`;
            localStorage.removeItem('pendingEmailVerification');
            setTimeout(() => {
              window.location.href = redirectUrl;
            }, 100);
            return;
          }
          const redirectPath = user.role === 'admin' ? '/admin' : '/dashboard';
          navigate(redirectPath);
        } else {
          const urlParams = new URLSearchParams(window.location.search);
          const verifyToken = urlParams.get('verify');
          if (verifyToken) {
            localStorage.setItem('pendingEmailVerification', verifyToken);
            window.history.replaceState({}, document.title, window.location.pathname);
            toast.info('Veuillez vous connecter pour finaliser la vérification de votre email');
          }
        }
      } catch (error) {
        // Erreur silencieuse
      } finally {
        setIsLoading(false);
      }
    };

    const timer = setTimeout(() => {
      verifyAuth().catch(err => {
        console.error('Erreur non gérée dans verifyAuth:', err);
      });
    }, 100);

    return () => {
      clearTimeout(timer);
    };
  }, [navigate]);

  if (isLoading) {
    return null;
  }

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  // ── Redirige après un login réussi (token reçu) ──
  const handleLoginSuccess = (data) => {
    const userToken = data.token;
    const userData = data.user || {};
    localStorage.setItem('token', userToken);
    if (userData.role) localStorage.setItem('role', userData.role);
    if (userData.username) localStorage.setItem('username', userData.username);
    const pendingVerification = localStorage.getItem('pendingEmailVerification');
    if (pendingVerification) {
      const verifyUrl = `/verify-email/${pendingVerification}`;
      localStorage.removeItem('pendingEmailVerification');
      setTimeout(() => { window.location.href = verifyUrl; }, 100);
      return;
    }
    const redirectPath = userData.role === 'admin' ? '/admin' : '/dashboard';
    setTimeout(() => { window.location.href = redirectPath; }, 50);
  };

  // ── Étape 1 : Connexion classique ──
  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage('');

    try {
      const res = await axiosAdmin.post('/api/auth/login', form, {
        validateStatus: status => status < 500,
      });

      if (res.data.twoFactorRequired) {
        // Le serveur demande un code 2FA
        setTempToken(res.data.tempToken);
        setStep('2fa');
        return;
      }

      if (res.data.token) {
        handleLoginSuccess(res.data);
      } else {
        let errorMessage;
        const serverMsg = res.data?.message || res.data?.error;
        if (res.status === 401) {
          errorMessage = serverMsg || 'Identifiants incorrects. Veuillez réessayer.';
        } else if (res.status === 403) {
          errorMessage = serverMsg || 'Accès refusé. Votre compte peut être désactivé.';
        } else if (res.status === 429) {
          errorMessage = serverMsg || 'Trop de tentatives. Réessayez dans quelques minutes.';
        } else {
          errorMessage = serverMsg || 'Échec de la connexion.';
        }
        setMessage(errorMessage);
        toast.error(errorMessage);
      }
    } catch (error) {
      const errorMessage = 'Impossible de se connecter au serveur. Vérifiez votre connexion internet.';
      setMessage(errorMessage);
      toast.error(errorMessage);
    }
  };

  // ── Étape 2 : Vérification TOTP ──
  const handle2FASubmit = async (e) => {
    e.preventDefault();
    setMessage('');
    setIs2FALoading(true);

    try {
      const res = await axiosAdmin.post('/api/auth/2fa/verify-login', {
        tempToken,
        code: totpCode,
      }, { validateStatus: status => status < 500 });

      if (res.data.token) {
        handleLoginSuccess(res.data);
      } else {
        const errorMessage = res.data?.error || 'Code invalide.';
        setMessage(errorMessage);
        toast.error(errorMessage);
      }
    } catch (error) {
      const errorMessage = 'Impossible de se connecter au serveur.';
      setMessage(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIs2FALoading(false);
    }
  };

  // ── Étape 2 : Utiliser un code de récupération ──
  const handleRecoverySubmit = async (e) => {
    e.preventDefault();
    setMessage('');
    setIs2FALoading(true);

    try {
      const res = await axiosAdmin.post('/api/auth/2fa/recover', {
        tempToken,
        recoveryCode,
      }, { validateStatus: status => status < 500 });

      if (res.data.token) {
        handleLoginSuccess(res.data);
      } else {
        const errorMessage = res.data?.error || 'Code de récupération invalide.';
        setMessage(errorMessage);
        toast.error(errorMessage);
      }
    } catch (error) {
      const errorMessage = 'Impossible de se connecter au serveur.';
      setMessage(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIs2FALoading(false);
    }
  };

  // ── Vue : Étape 2FA ──
  if (step === '2fa') {
    return (
      <div className={`${styles.formContainer} ${styles.loginFormContainer}`}>
        <div className={styles.logoContainer}>
          <img src="/img/logo.png" alt="Logo" className={styles.logo} />
        </div>

        {/* Icône bouclier */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.75rem' }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%',
            background: 'rgba(99,102,241,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
        </div>

        <h2 style={{ textAlign: 'center', marginBottom: '0.25rem', fontSize: '1.4rem', fontWeight: 700, color: 'var(--color-text)' }}>Vérification en deux étapes</h2>
        <p style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1.25rem', marginTop: 0 }}>
          {useRecovery
            ? 'Entrez un code de récupération'
            : "Entrez le code de votre application d'authentification"}
        </p>

        {!useRecovery ? (
          /* ── Formulaire TOTP ── */
          <form className={styles.form} onSubmit={handle2FASubmit}>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              value={totpCode}
              onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))}
              autoFocus
              autoComplete="one-time-code"
              style={{
                width: '100%',
                padding: '0.75rem',
                fontSize: '2rem',
                fontWeight: 700,
                letterSpacing: '0.35em',
                textIndent: '0.35em', /* compense l'espace trailing du letterSpacing */
                textAlign: 'center',
                background: 'var(--color-bg3)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius)',
                color: 'var(--color-text)',
                fontFamily: "'SF Mono', 'Fira Mono', monospace",
                boxSizing: 'border-box',
              }}
            />
            <button
              className={styles.button}
              type="submit"
              disabled={is2FALoading || totpCode.length !== 6}
            >
              {is2FALoading ? 'Vérification...' : 'Se connecter'}
            </button>
          </form>
        ) : (
          /* ── Formulaire code de récupération ── */
          <form className={styles.form} onSubmit={handleRecoverySubmit}>
            <input
              type="text"
              className={styles.input}
              placeholder="XXXXX-XXXXX"
              value={recoveryCode}
              onChange={e => setRecoveryCode(e.target.value)}
              autoFocus
              style={{ letterSpacing: '0.08em', textAlign: 'center', fontFamily: 'monospace' }}
            />
            <button
              className={styles.button}
              type="submit"
              disabled={is2FALoading || !recoveryCode.trim()}
            >
              {is2FALoading ? 'Vérification...' : 'Utiliser ce code'}
            </button>
          </form>
        )}

        {message && <div className={styles.message}>{message}</div>}

        <div style={{ marginTop: '1rem', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <button
            type="button"
            onClick={() => { setUseRecovery(v => !v); setMessage(''); setTotpCode(''); setRecoveryCode(''); }}
            style={{ background: 'none', border: 'none', color: '#6366f1', fontSize: '0.82rem', cursor: 'pointer', textDecoration: 'underline' }}
          >
            {useRecovery ? 'Utiliser mon application' : 'Code perdu ? Utiliser un code de récupération'}
          </button>
          <button
            type="button"
            onClick={() => { setStep('credentials'); setTempToken(''); setMessage(''); setTotpCode(''); setRecoveryCode(''); setUseRecovery(false); }}
            style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', fontSize: '0.82rem', cursor: 'pointer' }}
          >
            ← Retour
          </button>
        </div>
      </div>
    );
  }

  // ── Vue : Étape identifiants (défaut) ──
  return (
    <div className={`${styles.formContainer} ${styles.loginFormContainer}`}>
      <div className={styles.logoContainer}>
        <img
          src="/img/logo.png"
          alt="Logo"
          className={styles.logo}
        />
      </div>
      <h2 className={styles.title}>Connexion</h2>
      <form className={styles.form} onSubmit={handleSubmit}>
        <input className={styles.input} name="username" placeholder="Nom d'utilisateur" value={form.username} onChange={handleChange} required />
        <input className={styles.input} name="password" type="password" placeholder="Mot de passe" value={form.password} onChange={handleChange} required />
        <div style={{ textAlign: 'right', marginTop: '-0.25rem' }}>
          <Link to="/forgot-password" style={{ fontSize: '0.8rem', color: '#6366f1', textDecoration: 'none' }}>
            Mot de passe oublié ?
          </Link>
        </div>
        <button className={styles.button} type="submit">Se connecter</button>
      </form>
      {message && <div className={styles.message}>{message}</div>}
    </div>
  );
}

export default Login;