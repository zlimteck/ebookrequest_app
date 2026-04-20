import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import axiosAdmin from '../../axiosAdmin';
import styles from './VerifyEmail.module.css';

// Fonction utilitaire pour extraire le token de l'URL
const extractTokenFromUrl = () => {
  const pathParts = window.location.pathname.split('/');
  return pathParts[pathParts.length - 1];
};

const VerifyEmail = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading');
  const [message, setMessage] = useState('');

  // Vérifier le token de vérification
  useEffect(() => {
    const verifyEmail = async () => {
      const token = extractTokenFromUrl();
      if (!token || token === 'verify-email') {
        const errorMsg = 'Aucun token de vérification fourni dans l\'URL';
        setStatus('error');
        setMessage(errorMsg);
        return;
      }

      // Vérifier si l'utilisateur est connecté
      const currentToken = localStorage.getItem('token');
      if (!currentToken) {
        localStorage.setItem('pendingEmailVerification', token);
        window.location.href = '/login';
        return;
      }

      try {
const response = await axiosAdmin.get(`/api/users/verify-email/${token}`, {
          headers: { 'Authorization': `Bearer ${currentToken}` },
          validateStatus: status => status < 500
        });
        if (response.data.success) {
          setStatus('success');
          setMessage('Votre adresse email a été vérifiée avec succès !');
          toast.success('Email vérifié avec succès !');
          const userRole = response.data.user?.role || 'user';
          const redirectPath = userRole === 'admin' ? '/admin' : '/dashboard';
          setTimeout(() => {
            navigate(redirectPath);
          }, 2000);
        } else {
          const errorMsg = response.data.message || 'Échec de la vérification';
          throw new Error(errorMsg);
        }
      } catch (error) {
        const errorMessage = error.response?.data?.message || error.message || 'Une erreur est survenue lors de la vérification';
        setStatus('error');
        setMessage(errorMessage);
        toast.error(errorMessage);
      }
    };

    // Délai pour s'assurer que le composant est bien monté
    const timer = setTimeout(() => {
      verifyEmail().catch(() => {});
    }, 100);
    return () => {
      clearTimeout(timer);
    };
  }, [navigate]);

  return (
    <div className={styles.container}>
      {status === 'loading' && (
        <div className={`${styles.message} ${styles.loading}`}>
          <h2>Vérification en cours...</h2>
          <p>Veuillez patienter pendant que nous vérifions votre adresse email.</p>
        </div>
      )}

      {status === 'success' && (
        <div className={`${styles.message} ${styles.success}`}>
          <h2>✅ Vérification réussie !</h2>
          <p>{message}</p>
          <p>Vous allez être redirigé automatiquement...</p>
        </div>
      )}

      {status === 'error' && (
        <div className={`${styles.message} ${styles.error}`}>
          <h2>❌ Erreur lors de la vérification</h2>
          <p>{message}</p>
          <div className={styles.message}>
            <a 
              href="/login"
              className={styles.button}
            >
              Retour à la page de connexion
            </a>
          </div>
        </div>
      )}
    </div>
  );
};

export default VerifyEmail;