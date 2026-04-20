import axios from 'axios';
import { REACT_APP_API_URL } from './config';

const axiosAdmin = axios.create({
  baseURL: `${REACT_APP_API_URL}`,
  timeout: 60000, // Augmenté à 60 secondes pour les requêtes lentes (trending books)
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true // Important pour les cookies de session
});

// Intercepteur pour ajouter le token d'authentification
axiosAdmin.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Gestion des erreurs globales
axiosAdmin.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.code === 'ECONNABORTED') {
      console.error('La requête a expiré:', error.message);
      error.message = 'Le serveur met trop de temps à répondre. Veuillez réessayer.';
    } else if (error.response) {
      if (error.response.status === 401) {
        console.error('Erreur d\'authentification:', error.response.data);
        localStorage.removeItem('token');
        localStorage.removeItem('role');
        localStorage.removeItem('username');
        window.location.href = '/login';
      } else if (error.response.status >= 500) {
        console.error('Erreur serveur:', error.response.data);
        error.message = 'Erreur serveur. Veuillez réessayer plus tard.';
      } else {
        console.error('Erreur API:', error.response.data);
        error.message = error.response.data?.message || 'Une erreur est survenue';
      }
    } else if (error.request) {
      console.error('Pas de réponse du serveur:', error.request);
      error.message = 'Impossible de se connecter au serveur. Vérifiez votre connexion internet.';
    } else {
      console.error('Erreur de configuration:', error.message);
      error.message = 'Erreur de configuration. Veuillez réessayer.';
    }
    return Promise.reject(error);
  }
);

export default axiosAdmin;