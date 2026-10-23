import { useState, useEffect } from 'react';
import axiosAdmin from '../axiosAdmin';

// Suivi rapide d'un auteur depuis n'importe quel écran affichant un nom
// d'auteur (ex. BookPreviewModal) : résout le nom vers une clé Open Library
// stable puis crée l'abonnement, sans passer par la page dédiée.
export default function useQuickFollowAuthor() {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState({}); // par nom d'auteur : 'busy' | 'followed' | 'error'
  const [error, setError] = useState({});

  useEffect(() => {
    axiosAdmin.get('/api/authors/config')
      .then(res => setEnabled(res.data.enabled !== false))
      .catch(() => {});
  }, []);

  const follow = async (authorName) => {
    if (!authorName || status[authorName]) return;
    setStatus(s => ({ ...s, [authorName]: 'busy' }));
    try {
      const res = await axiosAdmin.get('/api/authors/search', { params: { q: authorName } });
      const match = (res.data.authors || []).find(
        a => a.name.trim().toLowerCase() === authorName.trim().toLowerCase()
      );
      if (!match) {
        setStatus(s => ({ ...s, [authorName]: 'error' }));
        setError(s => ({ ...s, [authorName]: 'Auteur introuvable sur Open Library.' }));
        return;
      }
      await axiosAdmin.post(`/api/authors/${match.openLibraryKey}/follow`, { autoRequest: false });
      setStatus(s => ({ ...s, [authorName]: 'followed' }));
    } catch (err) {
      setStatus(s => ({ ...s, [authorName]: 'error' }));
      setError(s => ({ ...s, [authorName]: err.response?.data?.error || 'Impossible de suivre cet auteur.' }));
    }
  };

  return { enabled, status, error, follow };
}
