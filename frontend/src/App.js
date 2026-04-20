import React, { useEffect, useState } from 'react';
import { Routes, Route, useLocation, Navigate, useNavigate } from 'react-router-dom';
import UserForm from './pages/user/UserForm';
import AdminPage from './pages/admin/AdminPage';
import UserDashboard from './pages/user/UserDashboard';
import DiscoverPage from './pages/user/DiscoverPage';
import Login from './pages/auth/Login';
import VerifyEmail from './pages/auth/VerifyEmail';
import ForgotPassword from './pages/auth/ForgotPassword';
import ResetPassword from './pages/auth/ResetPassword';
import UserSettings from './components/UserSettings';
import ProfilePage from './pages/user/ProfilePage';
import ReadingPage from './pages/user/ReadingPage';
import NotificationBell from './components/NotificationBell';
import NavDrawer from './components/NavDrawer';
import InstallPWABanner from './components/InstallPWABanner';
import styles from './styles/Navbar.module.css';
import { checkAuth, logout as authLogout } from './services/authService';
import useActivityTracker from './hooks/useActivityTracker';

document.body.style.margin = '0';
document.body.style.padding = '0';

const getAvatarColor = (username = '') => {
  const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#14b8a6'];
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
};

function App() {
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [avatar, setAvatar] = useState(null);

  useActivityTracker();

  useEffect(() => {
    const verifyAuth = async () => {
      const path = window.location.pathname;
      const isPublicPath =
        path.startsWith('/verify-email/') ||
        path === '/forgot-password' ||
        path.startsWith('/reset-password/');

      if (isPublicPath) {
        setIsLoading(false);
        return;
      }

      try {
        const { isAuthenticated, user } = await checkAuth();
        if (isAuthenticated && user) {
          localStorage.setItem('role', user.role);
          localStorage.setItem('username', user.username);
          setIsAdmin(user.role === 'admin');
          if (user.avatar) setAvatar(user.avatar);

          const hasVerifyToken = path.includes('verify=') ||
            localStorage.getItem('pendingEmailVerification');
          if (path === '/login' && !hasVerifyToken) {
            navigate(user.role === 'admin' ? '/admin' : '/dashboard', { replace: true });
          }
        } else if (!isPublicPath) {
          navigate('/login', { replace: true });
        }
      } catch (error) {
        console.error('Erreur lors de la vérification de l\'authentification:', error);
        if (!isPublicPath && path !== '/login') {
          navigate('/login', { replace: true });
        }
      } finally {
        setIsLoading(false);
      }
    };

    verifyAuth();
  }, [navigate]);

  // Écouter les mises à jour d'avatar depuis UserSettings
  useEffect(() => {
    const handleAvatarUpdate = (e) => setAvatar(e.detail);
    window.addEventListener('avatarUpdated', handleAvatarUpdate);
    return () => window.removeEventListener('avatarUpdated', handleAvatarUpdate);
  }, []);

  const handleLogout = () => {
    authLogout();
    setIsAdmin(false);
    setDrawerOpen(false);
  };

  const location = useLocation();
  const isAuthPage = location.pathname === '/login';
  const isVerifyEmailPage = location.pathname.startsWith('/verify-email/');
  const isForgotPage = location.pathname === '/forgot-password';
  const isResetPage = location.pathname.startsWith('/reset-password/');
  const token = localStorage.getItem('token');

  if (!isVerifyEmailPage && !isForgotPage && !isResetPage) {
    if (!token && !isAuthPage) {
      return <Navigate to="/login" replace state={{ from: location }} />;
    }
    const hasPendingVerification = localStorage.getItem('pendingEmailVerification');
    if (token && isAuthPage && !hasPendingVerification) {
      const role = localStorage.getItem('role');
      return <Navigate to={role === 'admin' ? '/admin' : '/dashboard'} replace />;
    }
  }

  if (isLoading) {
    return <div className="loading">Chargement...</div>;
  }

  if (location.pathname.startsWith('/verify-email/')) {
    return (
      <div style={{ margin: 0, padding: 0, width: '100%', overflowX: 'hidden' }}>
        <VerifyEmail />
      </div>
    );
  }

  if (isForgotPage) {
    return <ForgotPassword />;
  }

  if (isResetPage) {
    return <ResetPassword />;
  }

  if (isAuthPage) {
    return (
      <div style={{ margin: 0, padding: 0, width: '100%', overflowX: 'hidden' }}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </div>
    );
  }

  const username = localStorage.getItem('username') || '?';
  const role = localStorage.getItem('role') || 'user';

  return (
    <div style={{ margin: 0, padding: 0, width: '100%', overflowX: 'hidden' }}>
      {/* Navbar slim */}
      <nav className={styles.navbar}>
        <div className={styles.navContainer}>
          {/* Brand / Logo */}
          <div className={styles.navBrand}>
            <img src="/img/logo.png" alt="EbookRequest" className={styles.navBrandLogo} />
            <span className={styles.navBrandText}>EbookRequest</span>
          </div>

          {/* Actions droite */}
          <div className={styles.navActions}>
            {/* Avatar cliquable → page profil */}
            <div className={styles.navAvatar} title="Mon profil" onClick={() => navigate('/profile')} style={{ cursor: 'pointer' }}>
              {avatar ? (
                <img src={avatar} alt={username} className={styles.navAvatarImg} />
              ) : (
                <span className={styles.navAvatarLetter} style={{ background: getAvatarColor(username) }}>
                  {username[0]?.toUpperCase()}
                </span>
              )}
            </div>
            <NotificationBell />
            <button
              className={styles.hamburgerBtn}
              onClick={() => setDrawerOpen(true)}
              aria-label="Ouvrir le menu"
            >
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      </nav>

      {/* Drawer latéral */}
      <NavDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        isAdmin={isAdmin}
        avatar={avatar}
        username={username}
        role={role}
        onLogout={handleLogout}
      />

      {token && <InstallPWABanner />}

      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/admin"
          element={
            isAdmin ?
              <AdminPage /> :
              <Navigate to="/login" state={{ from: '/admin' }} replace />
          }
        />
        <Route
          path="/dashboard"
          element={
            token ?
              <UserDashboard /> :
              <Navigate to="/login" state={{ from: '/dashboard' }} replace />
          }
        />
        <Route
          path="/settings"
          element={
            token ?
              <UserSettings /> :
              <Navigate to="/login" state={{ from: '/settings' }} replace />
          }
        />
        <Route
          path="/reading"
          element={token ? <ReadingPage /> : <Navigate to="/login" state={{ from: '/reading' }} replace />}
        />
        <Route
          path="/discover"
          element={
            token ?
              <DiscoverPage /> :
              <Navigate to="/login" state={{ from: '/discover' }} replace />
          }
        />
        <Route
          path="/profile"
          element={token ? <ProfilePage /> : <Navigate to="/login" state={{ from: '/profile' }} replace />}
        />
        <Route
          path="/verify-email/:token"
          element={<VerifyEmail />}
        />
        <Route path="/" element={token ? <UserForm /> : <Navigate to="/login" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export default App;
