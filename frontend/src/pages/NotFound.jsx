import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axiosAdmin from '../axiosAdmin';
import styles from './NotFound.module.css';

export default function NotFound() {
  const navigate = useNavigate();

  useEffect(() => {
    // Succès "Ta vu elle est belle ma 404" — uniquement si déjà connecté, pour ne
    // pas déclencher le redirect automatique vers /login sur un 401 (interceptor
    // axiosAdmin) quand un visiteur non authentifié atterrit ici.
    if (localStorage.getItem('role')) {
      axiosAdmin.post('/api/users/me/achievements/found-404').catch(() => {});
    }
  }, []);

  return (
    <div className={styles.page}>
      {/* Livres flottants en arrière-plan */}
      <div className={styles.floatingBooks}>
        {['📚', '📖', '📕', '📗', '📘', '📙', '✨', '🔖', '📚', '📖'].map((emoji, i) => (
          <span key={i} className={styles.floatingBook} style={{ '--i': i }}>{emoji}</span>
        ))}
      </div>

      <div className={styles.card}>
        {/* Logo */}
        <img src="/img/logo.png" alt="EbookRequest" className={styles.logo} />

        {/* 404 animé */}
        <div className={styles.codeWrap}>
          <span className={styles.codeDigit}>4</span>
          <span className={styles.codeBook}>📖</span>
          <span className={styles.codeDigit}>4</span>
        </div>

        <h1 className={styles.title}>Ce chapitre est introuvable</h1>
        <p className={styles.subtitle}>
          Il semblerait que cette page ait été arrachée du livre…<br />
          Peut-être l'a-t-on prêtée à quelqu'un qui ne l'a jamais rendue.
        </p>

        <button className={styles.btn} onClick={() => navigate('/')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Retour à la bibliothèque
        </button>
      </div>
    </div>
  );
}