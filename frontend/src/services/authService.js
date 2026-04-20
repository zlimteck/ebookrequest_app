import axiosAdmin from '../axiosAdmin';

export const checkAuth = async () => {
  const token = localStorage.getItem('token');
  if (!token) return { isAuthenticated: false };

  // Vérifier si le token est expiré
  try {
    const decodedToken = JSON.parse(atob(token.split('.')[1]));
    const isExpired = decodedToken.exp * 1000 < Date.now();
    
    if (isExpired) {
      localStorage.removeItem('token');
      localStorage.removeItem('role');
      localStorage.removeItem('username');
      return { isAuthenticated: false };
    }

    // Vérifier la validité du token côté serveur
    const response = await axiosAdmin.get('/api/auth/check-token', {
      headers: { Authorization: `Bearer ${token}` }
    });

    return {
      isAuthenticated: true,
      user: response.data.user
    };
  } catch (error) {
    console.error('Erreur de vérification du token:', error);
    localStorage.removeItem('token');
    localStorage.removeItem('role');
    localStorage.removeItem('username');
    return { isAuthenticated: false };
  }
};

export const logout = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('role');
  localStorage.removeItem('username');
  window.location.href = '/login';
};