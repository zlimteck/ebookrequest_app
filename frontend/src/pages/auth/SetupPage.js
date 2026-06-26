import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axiosAdmin from '../../axiosAdmin';
import styles from '../user/UserForm.module.css';

const checkStrength = (password) => {
  let s = 0;
  if (password.length >= 8)                        s++;
  if (/[a-z]/.test(password))                      s++;
  if (/[A-Z]/.test(password))                      s++;
  if (/[0-9]/.test(password))                      s++;
  if (/[!@#$%^&*(),.?":{}|<>]/.test(password))    s++;
  return s;
};

const strengthLabel = (s) => {
  if (s <= 1) return { label: 'Très faible', cls: 'weak',   pct: '20%' };
  if (s === 2) return { label: 'Faible',      cls: 'weak',   pct: '40%' };
  if (s === 3) return { label: 'Moyen',       cls: 'medium', pct: '60%' };
  if (s === 4) return { label: 'Fort',        cls: 'strong', pct: '80%' };
  return              { label: 'Très fort',   cls: 'strong', pct: '100%' };
};

function SetupPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', email: '', password: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    axiosAdmin.get('/api/auth/setup-status')
      .then(({ data }) => {
        if (!data.setupRequired) navigate('/login', { replace: true });
      })
      .catch(() => { /* erreur réseau/rate-limit → on reste sur la page */ })
      .finally(() => setChecking(false));
  }, [navigate]);

  const handleChange = (e) => {
    setMessage('');
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) {
      setMessage('Les mots de passe ne correspondent pas.');
      return;
    }
    if (form.password.length < 8) {
      setMessage('Le mot de passe doit contenir au moins 8 caractères.');
      return;
    }
    if (checkStrength(form.password) < 3) {
      setMessage('Mot de passe trop faible. Ajoutez majuscules, chiffres ou caractères spéciaux.');
      return;
    }
    setLoading(true);
    setMessage('');
    try {
      const { data } = await axiosAdmin.post('/api/auth/setup', {
        username: form.username,
        email: form.email,
        password: form.password,
      });
      localStorage.setItem('role', data.role);
      localStorage.setItem('username', data.user.username);
      // Rechargement complet pour que verifyAuth initialise isAdmin correctement
      window.location.replace('/admin');
    } catch (err) {
      setMessage(err.response?.data?.error || 'Erreur lors de la création du compte.');
    } finally {
      setLoading(false);
    }
  };

  if (checking) return null;

  const strength = form.password ? checkStrength(form.password) : null;
  const { label, cls, pct } = strength !== null ? strengthLabel(strength) : {};

  return (
    <div className={`${styles.formContainer} ${styles.loginFormContainer}`}>
      <div className={styles.logoContainer}>
        <img src="/img/logo.png" alt="EbookRequest" className={styles.logo} />
      </div>

      <h2 className={styles.title}>Première configuration</h2>
      <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1.25rem', marginTop: '-0.5rem' }}>
        Créez le compte administrateur pour démarrer.
      </p>

      <form className={styles.form} onSubmit={handleSubmit}>
        <input
          className={styles.input}
          name="username"
          placeholder="Nom d'utilisateur"
          value={form.username}
          onChange={handleChange}
          autoComplete="off"
          required
        />
        <input
          className={styles.input}
          name="email"
          type="email"
          placeholder="Adresse email"
          value={form.email}
          onChange={handleChange}
          autoComplete="off"
          required
        />
        <div>
          <input
            className={styles.input}
            name="password"
            type="password"
            placeholder="Mot de passe (min. 8 caractères)"
            value={form.password}
            onChange={handleChange}
            required
          />
          {form.password && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.4rem' }}>
              <div style={{ flex: 1, height: 4, background: 'var(--color-border)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 2,
                  width: pct,
                  transition: 'width 0.3s, background 0.3s',
                  background: cls === 'weak' ? 'var(--color-danger)' : cls === 'medium' ? '#f59e0b' : '#10b981',
                }} />
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{label}</span>
            </div>
          )}
        </div>
        <input
          className={styles.input}
          name="confirm"
          type="password"
          placeholder="Confirmer le mot de passe"
          value={form.confirm}
          onChange={handleChange}
          required
        />
        <button
          className={styles.button}
          type="submit"
          disabled={loading || !form.username || !form.email || !form.password || !form.confirm}
        >
          {loading ? 'Création...' : 'Créer le compte administrateur'}
        </button>
      </form>
      {message && <div className={styles.message}>{message}</div>}
    </div>
  );
}

export default SetupPage;