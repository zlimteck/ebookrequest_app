import React, { useEffect, useState } from 'react';
import axiosAdmin from '../../axiosAdmin';
import styles from '../user/UserForm.module.css';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';

// ── Mode email invitation (token dans l'URL) ──────────────────────────────────
function RegisterWithToken({ token }) {
  const navigate = useNavigate();
  const [step, setStep]             = useState('validating');
  const [email, setEmail]           = useState('');
  const [form, setForm]             = useState({ username: '', password: '', confirm: '' });
  const [message, setMessage]       = useState('');
  const [loading, setLoading]       = useState(false);
  const [tokenError, setTokenError] = useState('');

  useEffect(() => {
    axiosAdmin.get(`/api/invitations/validate/${token}`)
      .then(r => { setEmail(r.data.email); setStep('form'); })
      .catch(e => {
        setStep('error');
        setTokenError(e.response?.data?.error || 'Invitation invalide ou expirée.');
      });
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage('');
    if (form.password !== form.confirm) { setMessage('Les mots de passe ne correspondent pas.'); return; }
    if (form.password.length < 8)       { setMessage('Le mot de passe doit contenir au moins 8 caractères.'); return; }
    if ([/[a-z]/, /[A-Z]/, /[0-9]/, /[!@#$%^&*(),.?":{}|<>]/].filter(r => r.test(form.password)).length < 3) { setMessage('Mot de passe trop faible. Utilisez au moins 3 des éléments suivants : minuscule, majuscule, chiffre, caractère spécial.'); return; }
    setLoading(true);
    try {
      const res = await axiosAdmin.post('/api/invitations/register', {
        token,
        username: form.username.trim(),
        password: form.password,
      });
      localStorage.setItem('role',     res.data.role);
      localStorage.setItem('username', res.data.user.username);
      setStep('done');
      setTimeout(() => navigate('/dashboard'), 2000);
    } catch (e) {
      setMessage(e.response?.data?.error || 'Erreur lors de la création du compte.');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'validating') {
    return <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', margin: '1rem 0' }}>Vérification de l'invitation…</p>;
  }

  if (step === 'error') {
    return (
      <>
        <p className={styles.message} style={{ textAlign: 'center' }}>{tokenError}</p>
        <Link to="/login" style={{ fontSize: '0.82rem', color: 'var(--color-accent)', textDecoration: 'none', textAlign: 'center', display: 'block', marginTop: '0.5rem' }}>
          ← Retour à la connexion
        </Link>
      </>
    );
  }

  if (step === 'done') {
    return (
      <div style={{ textAlign: 'center', padding: '1rem 0' }}>
        <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(16,185,129,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.75rem' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5"/>
          </svg>
        </div>
        <p style={{ color: 'var(--color-text)', fontWeight: 600, margin: '0 0 0.25rem' }}>Compte créé avec succès !</p>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem', margin: 0 }}>Redirection en cours…</p>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <input className={styles.input} type="email" value={email} readOnly
        style={{ opacity: 0.65, cursor: 'not-allowed' }} />
      <input className={styles.input} type="text" placeholder="Nom d'utilisateur"
        value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} required autoFocus />
      <input className={styles.input} type="password" placeholder="Mot de passe (min. 8 caractères)"
        value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required />
      <input className={styles.input} type="password" placeholder="Confirmer le mot de passe"
        value={form.confirm} onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))} required />
      {message && <div className={styles.message}>{message}</div>}
      <button className={styles.button} type="submit" disabled={loading}>
        {loading ? 'Création en cours…' : 'Créer mon compte'}
      </button>
      <div style={{ textAlign: 'center' }}>
        <Link to="/login" style={{ fontSize: '0.82rem', color: 'var(--color-accent)', textDecoration: 'none' }}>
          Déjà un compte ? Se connecter
        </Link>
      </div>
    </form>
  );
}

// ── Mode code d'invitation ────────────────────────────────────────────────────
function RegisterWithCode() {
  const [form, setForm]       = useState({ username: '', email: '', password: '', confirm: '', code: '' });
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: name === 'code' ? value.toUpperCase() : value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage('');
    if (form.password !== form.confirm) { setMessage('Les mots de passe ne correspondent pas.'); return; }
    if (form.password.length < 8)       { setMessage('Le mot de passe doit contenir au moins 8 caractères.'); return; }
    if ([/[a-z]/, /[A-Z]/, /[0-9]/, /[!@#$%^&*(),.?":{}|<>]/].filter(r => r.test(form.password)).length < 3) { setMessage('Mot de passe trop faible. Utilisez au moins 3 des éléments suivants : minuscule, majuscule, chiffre, caractère spécial.'); return; }
    setLoading(true);
    try {
      const res = await axiosAdmin.post('/api/invitation-codes/register', {
        username: form.username.trim(),
        email:    form.email.trim(),
        password: form.password,
        code:     form.code.trim(),
      }, { validateStatus: s => s < 500 });

      if (res.data.success) {
        setSuccess(true);
      } else {
        setMessage(res.data.error || 'Une erreur est survenue.');
      }
    } catch {
      setMessage('Impossible de contacter le serveur.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div style={{ textAlign: 'center', padding: '1rem 0' }}>
        <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(16,185,129,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.75rem' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5"/>
          </svg>
        </div>
        <p style={{ color: 'var(--color-text)', fontWeight: 600, margin: '0 0 0.5rem' }}>Compte créé !</p>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.88rem', lineHeight: 1.6, margin: '0 0 1.25rem' }}>
          Un email de vérification a été envoyé à <strong style={{ color: 'var(--color-text)' }}>{form.email}</strong>.<br />
          Vérifiez votre boîte mail avant de vous connecter.
        </p>
        <Link to="/login" style={{ fontSize: '0.88rem', color: 'var(--color-accent)', textDecoration: 'none' }}>
          Aller à la connexion →
        </Link>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <input className={styles.input} type="text" name="username" placeholder="Nom d'utilisateur"
        value={form.username} onChange={handleChange} autoComplete="username" required autoFocus />
      <input className={styles.input} type="email" name="email" placeholder="Adresse email"
        value={form.email} onChange={handleChange} autoComplete="email" required />
      <input className={styles.input} type="password" name="password" placeholder="Mot de passe (min. 8 caractères)"
        value={form.password} onChange={handleChange} autoComplete="new-password" required />
      <input className={styles.input} type="password" name="confirm" placeholder="Confirmer le mot de passe"
        value={form.confirm} onChange={handleChange} autoComplete="new-password" required />
      <input className={styles.input} type="text" name="code" placeholder="Code d'invitation (ex : A3F7-KX92)"
        value={form.code} onChange={handleChange} autoComplete="off"
        style={{ letterSpacing: '0.08em', fontFamily: 'monospace', textTransform: 'uppercase' }}
        required />
      {message && <div className={styles.message}>{message}</div>}
      <button className={styles.button} type="submit" disabled={loading}>
        {loading ? 'Création en cours…' : 'Créer mon compte'}
      </button>
      <div style={{ textAlign: 'center' }}>
        <Link to="/login" style={{ fontSize: '0.82rem', color: 'var(--color-accent)', textDecoration: 'none' }}>
          Déjà un compte ? Se connecter
        </Link>
      </div>
    </form>
  );
}

// ── Composant principal ───────────────────────────────────────────────────────
export default function Register() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  return (
    <div className={`${styles.formContainer} ${styles.loginFormContainer}`}>
      <div className={styles.logoContainer}>
        <img src="/img/logo.png" alt="EbookRequest" className={styles.logo} />
      </div>
      <h2 className={styles.title}>Créer mon compte</h2>
      {token ? <RegisterWithToken token={token} /> : <RegisterWithCode />}
    </div>
  );
}
