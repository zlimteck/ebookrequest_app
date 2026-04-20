import React, { useState } from 'react';
import axiosAdmin from '../../axiosAdmin';
import styles from './Auth.module.css';
import { Link } from 'react-router-dom';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.trim()) { setError('Email requis.'); return; }
    try {
      setLoading(true);
      await axiosAdmin.post('/api/auth/forgot-password', { email: email.trim() });
      setSent(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur serveur, réessayez.');
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

        {sent ? (
          <div className={styles.successBox}>
            <svg width="40" height="40" fill="none" viewBox="0 0 24 24" stroke="#10b981" strokeWidth="1.5">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
              <polyline points="22,6 12,13 2,6"/>
            </svg>
            <h2 className={styles.title}>Email envoyé !</h2>
            <p className={styles.subtitle}>
              Si cet email est associé à un compte, vous recevrez un lien de réinitialisation dans quelques instants.
              Vérifiez également vos spams.
            </p>
            <Link to="/login" className={styles.backLink}>← Retour à la connexion</Link>
          </div>
        ) : (
          <>
            <h2 className={styles.title}>Mot de passe oublié</h2>
            <p className={styles.subtitle}>
              Entrez votre adresse email, nous vous enverrons un lien pour réinitialiser votre mot de passe.
            </p>
            <form className={styles.form} onSubmit={handleSubmit}>
              <div className={styles.inputGroup}>
                <span className={styles.inputIcon}>
                  <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                    <polyline points="22,6 12,13 2,6"/>
                  </svg>
                </span>
                <input
                  className={styles.input}
                  type="email"
                  placeholder="votre@email.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  autoFocus
                />
              </div>
              {error && <p className={styles.error}>{error}</p>}
              <button className={styles.btn} type="submit" disabled={loading}>
                {loading ? <span className={styles.spinner} /> : 'Envoyer le lien'}
              </button>
            </form>
            <Link to="/login" className={styles.backLink}>← Retour à la connexion</Link>
          </>
        )}
      </div>
    </div>
  );
}