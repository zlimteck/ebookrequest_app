import React, { useEffect, useState } from 'react';
import axiosAdmin from '../../axiosAdmin';
import styles from './Auth.module.css';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';

export default function Register() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  const [step, setStep] = useState('validating'); // validating | form | done | error
  const [email, setEmail] = useState('');
  const [form, setForm] = useState({ username: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [tokenError, setTokenError] = useState('');

  useEffect(() => {
    if (!token) {
      setStep('error');
      setTokenError('Lien d\'invitation manquant ou invalide.');
      return;
    }
    axiosAdmin.get(`/api/invitations/validate/${token}`)
      .then(r => {
        setEmail(r.data.email);
        setStep('form');
      })
      .catch(e => {
        setStep('error');
        setTokenError(e.response?.data?.error || 'Invitation invalide ou expirée.');
      });
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }
    if (form.password.length < 6) {
      setError('Le mot de passe doit contenir au moins 6 caractères.');
      return;
    }
    setLoading(true);
    try {
      const res = await axiosAdmin.post('/api/invitations/register', {
        token,
        username: form.username.trim(),
        password: form.password,
      });
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('role', res.data.role);
      localStorage.setItem('username', res.data.user.username);
      setStep('done');
      setTimeout(() => navigate('/dashboard'), 2000);
    } catch (e) {
      setError(e.response?.data?.error || 'Erreur lors de la création du compte.');
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
        <h1 className={styles.title}>Créer mon compte</h1>

        {step === 'validating' && (
          <p className={styles.subtitle}>Vérification de l'invitation…</p>
        )}

        {step === 'error' && (
          <div className={styles.successBox}>
            <p className={styles.error}>{tokenError}</p>
            <Link to="/login" className={styles.backLink}>← Retour à la connexion</Link>
          </div>
        )}

        {step === 'done' && (
          <div className={styles.successBox}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
              <polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            <p style={{ color: '#f8fafc', fontWeight: 600, margin: 0 }}>Compte créé avec succès !</p>
            <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: 0 }}>Redirection en cours…</p>
          </div>
        )}

        {step === 'form' && (
          <form className={styles.form} onSubmit={handleSubmit}>
            {/* Email pré-rempli et verrouillé */}
            <div className={styles.inputGroup}>
              <span className={styles.inputIcon}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                  <polyline points="22,6 12,13 2,6"/>
                </svg>
              </span>
              <input
                className={styles.input}
                type="email"
                value={email}
                readOnly
                style={{ opacity: 0.65, cursor: 'not-allowed' }}
              />
            </div>

            {/* Nom d'utilisateur */}
            <div className={styles.inputGroup}>
              <span className={styles.inputIcon}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              </span>
              <input
                className={styles.input}
                type="text"
                placeholder="Nom d'utilisateur"
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                required
                autoFocus
              />
            </div>

            {/* Mot de passe */}
            <div className={styles.inputGroup}>
              <span className={styles.inputIcon}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
              </span>
              <input
                className={styles.input}
                type="password"
                placeholder="Mot de passe (min. 6 caractères)"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                required
              />
            </div>

            {/* Confirmation */}
            <div className={styles.inputGroup}>
              <span className={styles.inputIcon}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
              </span>
              <input
                className={styles.input}
                type="password"
                placeholder="Confirmer le mot de passe"
                value={form.confirm}
                onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
                required
              />
            </div>

            {error && <p className={styles.error}>{error}</p>}

            <button className={styles.btn} type="submit" disabled={loading}>
              {loading ? <span className={styles.spinner} /> : 'Créer mon compte'}
            </button>

            <Link to="/login" className={styles.backLink} style={{ textAlign: 'center', marginTop: '0.25rem' }}>
              Déjà un compte ? Se connecter
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}