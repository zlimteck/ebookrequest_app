import React, { useState, useEffect } from 'react';
import axiosAdmin from '../../axiosAdmin';
import styles from '../user/UserForm.module.css';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'react-toastify';
import { REACT_APP_API_URL } from '../../config';

function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [form, setForm] = useState({ username: '', password: '' });
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const verifyToken = searchParams.get('verify');
  
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
    
    // Délai pour s'assurer que le composant est bien monté
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage('');

    try {
      const res = await axiosAdmin.post('/api/auth/login', form, {
        validateStatus: status => status < 500,
      });

      if (res.data.token) {
        const userToken = res.data.token;
        const userData = res.data.user || {};
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
      } else {
        // Réponse 4xx — le message vient directement du serveur
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
      // Erreur réseau uniquement (pas de réponse du serveur)
      const errorMessage = 'Impossible de se connecter au serveur. Vérifiez votre connexion internet.';
      setMessage(errorMessage);
      toast.error(errorMessage);
    }
  };

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