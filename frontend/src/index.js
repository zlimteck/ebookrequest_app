import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { register } from './serviceWorkerRegistration';

// Capturer beforeinstallprompt avant que React ne monte (l'événement peut
// se déclencher très tôt, avant que useEffect soit enregistré)
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__pwaInstallPrompt = e;
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);

// Enregistre le service worker (cache offline + push notifications)
register();