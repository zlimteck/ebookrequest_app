import React, { useState } from 'react';
import axiosAdmin from '../../axiosAdmin';
import styles from './Auth.module.css';
import { Link, useNavigate } from 'react-router-dom';

export default function ResetPassword() {
  // useParams() ne fonctionne pas hors de <Routes> — on lit directement l'URL
  const token = window.location.pathname.split('/reset-password/')[1];
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) { setError('Minimum 6 caractères.'); return; }
    if (password !== confirm) { setError('Les mots de passe ne correspondent pas.'); return; }
    try {
      setLoading(true);
      await axiosAdmin.post(`/api/auth/reset-password/${token}`, { password });
      setDone(true);
      setTimeout(() => navigate('/login'), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Lien invalide ou expiré.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logoWrap}>
          <img src="/img/logo.png" alt="EbookRequest" className={styles.logo} />
        </div>

        {done ? (
          <div className={styles.successBox}>
            <svg width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="#10b981" strokeWidth="1.5">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <h2 className={styles.title}>Mot de passe mis à jour !</h2>
            <p className={styles.subtitle}>
              Votre mot de passe a été réinitialisé avec succès. Vous allez être redirigé vers la connexion...
            </p>
            <Link to="/login" className={styles.backLink}>Se connecter maintenant</Link>
          </div>
        ) : (
          <>
            <h2 className={styles.title}>Nouveau mot de passe</h2>
            <p className={styles.subtitle}>Choisissez un nouveau mot de passe pour votre compte.</p>
            <form className={styles.form} onSubmit={handleSubmit}>
              <div className={styles.inputGroup}>
                <span className={styles.inputIcon}>
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                </span>
                <input
                  className={styles.input}
                  type="password"
                  placeholder="Nouveau mot de passe"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoFocus
                />
              </div>
              <div className={styles.inputGroup}>
                <span className={styles.inputIcon}>
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                  </svg>
                </span>
                <input
                  className={styles.input}
                  type="password"
                  placeholder="Confirmer le mot de passe"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                />
              </div>
              {error && <p className={styles.error}>{error}</p>}
              <button className={styles.btn} type="submit" disabled={loading}>
                {loading ? <span className={styles.spinner} /> : 'Réinitialiser le mot de passe'}
              </button>
            </form>
            <Link to="/login" className={styles.backLink}>← Retour à la connexion</Link>
          </>
        )}
      </div>
    </div>
  );
}