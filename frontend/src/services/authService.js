import axiosAdmin from '../axiosAdmin';

export const checkAuth = async () => {
  try {
    const response = await axiosAdmin.get('/api/auth/check-token');
    return {
      isAuthenticated: true,
      user: response.data.user
    };
  } catch (error) {
    localStorage.removeItem('role');
    localStorage.removeItem('username');
    return { isAuthenticated: false };
  }
};

export const logout = async () => {
  try {
    await axiosAdmin.post('/api/auth/logout');
  } catch {
    // silencieux
  }
  localStorage.removeItem('role');
  localStorage.removeItem('username');
  localStorage.removeItem('hasValentine');
  window.location.href = '/login';
};
