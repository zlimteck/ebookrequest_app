import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import axiosAdmin from '../../axiosAdmin';
import GoogleBooksSearch from '../../components/GoogleBooksSearch';
import BookRecommendations from '../../components/BookRecommendations';
import SeriesModal from '../../components/SeriesModal';
import { compressImage, isImage } from '../../utils/imageCompressor';
import styles from './UserForm.module.css';


function detectSeriesIndex(title) {
  const patterns = [/tome\s*(\d+)/i, /vol(?:ume)?\.?\s*(\d+)/i, /#\s*(\d+)/i, /,\s*t\s*(\d+)/i];
  for (const p of patterns) {
    const m = (title || '').match(p);
    if (m) return parseInt(m[1]);
  }
  return null;
}

function extractSeriesName(title) {
  return (title || '')
    .replace(/tome\s*\d+/i, '')
    .replace(/vol(?:ume)?\.?\s*\d+/i, '')
    .replace(/,\s*t\s*\d+/i, '')
    .replace(/#\s*\d+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[,\s—–-]+$/, '');
}

// Conversion format français ↔ ISO pour la date de sortie
function frToIso(str) {
  const s = (str || '').trim();
  if (/^\d{4}$/.test(s)) return s;
  if (/^\d{2}\/\d{4}$/.test(s)) { const [m, y] = s.split('/'); return `${y}-${m}`; }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) { const [d, m, y] = s.split('/'); return `${y}-${m}-${d}`; }
  return s;
}
function isoToFr(str) {
  if (!str) return '';
  const parts = str.split('-');
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[1]}/${parts[0]}`;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
  </svg>
);

const EditIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
);

// Composant pour afficher les informations du livre sélectionné
const SelectedBookInfo = ({ book, onRemove }) => {
  if (!book || !book.volumeInfo) return null;
  const {
    title = 'Titre inconnu',
    authors,
    publishedDate,
    pageCount,
    imageLinks
  } = book.volumeInfo || {};

  const thumbnailUrl = imageLinks?.thumbnail?.replace('http://', 'https://');
  const authorText = authors?.length ? authors.join(', ') : 'Auteur inconnu';
  const year = publishedDate ? new Date(publishedDate).getFullYear() : null;

  return (
    <div className={styles.selectedBook}>
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt={`Couverture de ${title}`}
          className={styles.bookThumbnail}
          loading="lazy"
        />
      ) : (
        <div className={styles.thumbnailPlaceholder}>
          <span>—</span>
        </div>
      )}
      <div className={styles.bookDetails}>
        <span className={styles.selectedBookLabel}>Livre sélectionné</span>
        <h4 className={styles.selectedBookTitle}>{title}</h4>
        <p className={styles.selectedBookMeta}>{authorText}{year ? ` · ${year}` : ''}{pageCount ? ` · ${pageCount} p.` : ''}</p>
      </div>
    </div>
  );
};

function detectCategory(categories) {
  if (!categories?.length) return 'ebook';
  const joined = categories.join(' ').toLowerCase();
  if (/manga|manhwa|manhua/.test(joined)) return 'manga';
  if (/bande.dessin|comic|graphic.novel|\bbd\b/.test(joined)) return 'comic';
  return 'ebook';
}

function UserForm() {
  const navigate = useNavigate();
  const location = useLocation();
  const fileInputRef = useRef(null);
  const [form, setForm] = useState({
    author: '',
    title: '',
    genre: '',
    year: '',
    description: '',
    coverImage: null,
    coverImagePreview: '',
    file: null,
    format: 'epub',
    category: 'ebook'
  });
  const [message, setMessage] = useState({ text: '', type: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [batchProgress, setBatchProgress] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [searchMode, setSearchMode] = useState('google');
  const [selectedBook, setSelectedBook] = useState(null);
  const [rawPublishedDate, setRawPublishedDate] = useState('');
  const [seriesInfo, setSeriesInfo]   = useState(null); // { name, index }
  const [seriesModal, setSeriesModal] = useState(false);
  const [submittedBook, setSubmittedBook] = useState(null);
  const [existingRequests, setExistingRequests] = useState([]);
  const [availability, setAvailability] = useState(null);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [quota, setQuota] = useState(null);
  const [valentineQuota, setValentineQuota] = useState(null);
  const isAdmin = localStorage.getItem('role') === 'admin';
  const [users, setUsers] = useState([]);
  const [targetUserId, setTargetUserId] = useState('');
  const [calibreEnabled, setCalibreEnabled] = useState(false);
  const [calibreShelves, setCalibreShelves] = useState([]); // [{ name, isDefault }]
  const [selectedShelves, setSelectedShelves] = useState([]);
  const [shelfPickerOpen, setShelfPickerOpen] = useState(false);
  // Multishelf multi-utilisateurs (admin) — comptes Calibre-Web ciblables en
  // plus du propriétaire de la demande, et sélection courante par user.
  const [shelfTargetUsers, setShelfTargetUsers] = useState([]); // [{ _id, username, shelves: [{name,isDefault}] }]
  const [extraShelfSelections, setExtraShelfSelections] = useState({}); // { [userId]: [shelfName, ...] }

  // Fonction pour vérifier la disponibilité du livre
  const checkAvailability = useCallback(async (title, author, publishedDate) => {
    if (!title || !author) return;

    setCheckingAvailability(true);
    setAvailability(null);

    try {
      const response = await axiosAdmin.post('/api/availability/check', {
        title,
        author,
        ...(publishedDate ? { publishedDate } : {}),
      });

      if (response.data.success) {
        setAvailability(response.data);
      }
    } catch (error) {
      console.error('Erreur lors de la vérification de disponibilité:', error);
      setAvailability({
        available: false,
        confidence: 'unknown',
        message: 'Impossible de vérifier la disponibilité pour le moment'
      });
    } finally {
      setCheckingAvailability(false);
    }
  }, []);

  // Vérifier si l'utilisateur est connecté et charger les demandes existantes
  useEffect(() => {
    let isMounted = true;
    const init = async () => {
      if (isMounted) {
          setIsAuthenticated(true);
          const promises = [fetchExistingRequests(), fetchQuota(), fetchCalibreShelves()];
          if (localStorage.getItem('role') === 'admin') { promises.push(fetchUsers()); promises.push(fetchShelfTargets()); }
          // Quota Valentine personnel (silencieux — absent si pas de compte)
          if (localStorage.getItem('role') !== 'admin') {
            axiosAdmin.get('/api/users/valentine/quota')
              .then(r => { if (isMounted) setValentineQuota(r.data); })
              .catch(() => {});
          }
          await Promise.all(promises);

          // Vérifier s'il y a des données pré-remplies depuis la page Découvrir
          if (location.state?.prefillData) {
            const prefill = location.state.prefillData;
            setForm(prev => ({
              ...prev,
              title: prefill.title || '',
              author: prefill.author || '',
              link: prefill.link || '',
              description: prefill.description || '',
              coverImagePreview: prefill.thumbnail || '',
              pages: prefill.pageCount || ''
            }));
            setSearchMode('manual');

            // Vérifier la disponibilité et les doublons si on a un titre et un auteur
            if (prefill.title && prefill.author) {
              checkAvailability(prefill.title, prefill.author, prefill.publishedDate);
            }
          }
      }
    };

    init();

    return () => {
      isMounted = false;
      setMessage({ text: '', type: '' });
    };
  }, [navigate, location.state, checkAvailability]);
  
  // Charger le quota (du user cible si admin a sélectionné quelqu'un)
  const fetchQuota = async (userId = '') => {
    try {
      const params = userId ? { userId } : {};
      const response = await axiosAdmin.get('/api/requests/quota', { params });
      setQuota(response.data);
    } catch (error) {
      console.error('Erreur lors du chargement du quota:', error);
    }
  };

  // Charger la config Calibre-Web (étagères configurées) pour le sélecteur du
  // formulaire — reflète toujours le compte du demandeur connecté, pas celui
  // d'un targetUserId choisi par un admin (pas d'endpoint pour ça côté admin).
  const fetchCalibreShelves = async () => {
    try {
      const res = await axiosAdmin.get('/api/users/calibre');
      const enabled = res.data?.enabled && Array.isArray(res.data.shelves) && res.data.shelves.length > 0;
      setCalibreEnabled(enabled);
      setCalibreShelves(res.data?.shelves || []);
      setSelectedShelves((res.data?.shelves || []).filter(s => s.isDefault).map(s => s.name));
    } catch {
      setCalibreEnabled(false);
    }
  };

  const toggleShelf = (name) => {
    setSelectedShelves(prev => prev.includes(name) ? prev.filter(s => s !== name) : [...prev, name]);
  };

  // Charger la liste des users (admin uniquement)
  const fetchUsers = async () => {
    try {
      const response = await axiosAdmin.get('/api/admin/users');
      setUsers(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error('Erreur lors du chargement des utilisateurs:', error);
    }
  };

  // Comptes Calibre-Web ciblables pour le multishelf multi-utilisateurs
  // (admin uniquement) — sert à la fois pour les étagères du user cible et
  // pour la liste des cibles additionnelles.
  const fetchShelfTargets = async () => {
    try {
      const response = await axiosAdmin.get('/api/requests/calibre/shelf-targets');
      setShelfTargetUsers(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error('Erreur lors du chargement des comptes Calibre-Web:', error);
    }
  };

  const toggleExtraShelf = (userId, shelfName) => {
    setExtraShelfSelections(prev => {
      const current = prev[userId] || [];
      const next = current.includes(shelfName)
        ? current.filter(s => s !== shelfName)
        : [...current, shelfName];
      const updated = { ...prev };
      if (next.length) updated[userId] = next; else delete updated[userId];
      return updated;
    });
  };

  // Fonction pour charger les demandes existantes de l'utilisateur
  const fetchExistingRequests = async () => {
    try {
      const response = await axiosAdmin.get('/api/requests/my-requests');
      if (response.data) {
        setExistingRequests(response.data);
      }
    } catch (error) {
      console.error('Erreur lors du chargement des demandes existantes:', error);
    }
  };

  const handleChange = async (e) => {
    const { name, value, files } = e.target;
    if (name === 'coverImage' && files && files[0]) {
      const file = files[0];
      if (isImage(file) && file.size > 1 * 1024 * 1024) { // > 1MB
        try {
          setMessage({ text: 'Compression de l\'image en cours...', type: 'info' });
          const compressedFile = await compressImage(file, {
            maxSizeMB: 1,
            maxWidthOrHeight: 1200
          });
          
          const reader = new FileReader();
          reader.onloadend = () => {
            setForm(prev => ({
              ...prev,
              coverImage: compressedFile,
              coverImagePreview: reader.result
            }));
            setMessage({ text: 'Image compressée avec succès', type: 'success' });
          };
          reader.readAsDataURL(compressedFile);
          
          // Affiche un message sur la réduction de taille
          const originalSize = (file.size / 1024 / 1024).toFixed(2);
          const newSize = (compressedFile.size / 1024 / 1024).toFixed(2);
          console.log(`Taille réduite de ${originalSize} Mo à ${newSize} Mo`);
          
        } catch (error) {
          console.error('Erreur lors de la compression de l\'image:', error);
          setMessage({ 
            text: 'Erreur lors de la compression de l\'image. Utilisation de l\'image originale.', 
            type: 'warning' 
          });
          // En cas d'erreur, utiliser l'image originale
          const reader = new FileReader();
          reader.onloadend = () => {
            setForm(prev => ({
              ...prev,
              coverImage: file,
              coverImagePreview: reader.result
            }));
          };
          reader.readAsDataURL(file);
        }
      } else {
        // Si l'image est déjà assez petite, l'utiliser directement
        const reader = new FileReader();
        reader.onloadend = () => {
          setForm(prev => ({
            ...prev,
            coverImage: file,
            coverImagePreview: reader.result
          }));
        };
        reader.readAsDataURL(file);
      }
    } else if (name === 'file' && files && files[0]) {
      const file = files[0];
      
      // Vérifie si c'est un fichier volumineux (plus de 5MB)
      if (file.size > 5 * 1024 * 1024) {
        setMessage({ 
          text: 'Le fichier est trop volumineux (max 5 Mo). Veuillez choisir un fichier plus petit.', 
          type: 'error' 
        });
        e.target.value = '';
        return;
      }
      
      setForm(prev => ({
        ...prev,
        file: file
      }));
    } else {
      setForm(prev => ({
        ...prev,
        [name]: value
      }));
    }
  };

  const handleBookSelect = useCallback((book, searchContext = {}) => {
    if (!book) return false;

    // Vérifie si ce livre a déjà été demandé (ignoré si admin soumet pour un autre user)
    if (book.id && !targetUserId) {
      const isDuplicate = existingRequests.some(req => {
        return req.googleBooksId === book.id ||
              (req.title === book.volumeInfo?.title &&
               req.author === book.volumeInfo?.authors?.[0]);
      });

      if (isDuplicate) {
        setMessage({
          text: 'Vous avez déjà demandé ce livre. Vérifiez vos demandes en attente.',
          type: 'error'
        });
        return false;
      }
    }

    // Si on arrive ici, c'est qu'il n'y a pas de doublon
    // (patch) : nettoyer un eventuel message d'erreur laisse par une
    // selection precedente (ex: "deja demande" sur un AUTRE livre), sinon il
    // reste affiche indefiniment sur les selections suivantes valides.
    setMessage({ text: '', type: '' });
    setSelectedBook(book);

    // Mettre à jour le formulaire avec les informations du livre
    if (book.volumeInfo) {
      // Construire l'URL Google Books si elle n'est pas fournie
      const googleBooksLink = book.volumeInfo.infoLink || `https://books.google.fr/books?id=${book.id}`;

      const title = book.volumeInfo.title || '';
      const author = book.volumeInfo.authors?.[0] || '';

      setRawPublishedDate(book.volumeInfo.publishedDate || '');

      // Détection de la série
      const si = book.volumeInfo.seriesInfo;
      if (si?.shortSeriesBookTitle) {
        setSeriesInfo({
          name:  si.shortSeriesBookTitle,
          index: parseInt(si.bookDisplayNumber) || si.volumeSeries?.[0]?.orderNumber || null,
        });
      } else if (searchContext.searchMode === 'series' && searchContext.searchedValue) {
        // L'utilisateur a cherché explicitement par nom de série → on sait que ce livre en fait partie
        setSeriesInfo({
          name:  searchContext.searchedValue,
          index: detectSeriesIndex(title),
        });
      } else {
        const detectedIndex = detectSeriesIndex(title);
        if (detectedIndex) {
          setSeriesInfo({ name: extractSeriesName(title), index: detectedIndex });
        } else {
          setSeriesInfo(null);
        }
      }

      setForm(prev => ({
        ...prev,
        title: title,
        author: book.volumeInfo.authors?.join(', ') || '',
        year: book.volumeInfo.publishedDate ? new Date(book.volumeInfo.publishedDate).getFullYear() : '',
        description: book.volumeInfo.description || '',
        link: googleBooksLink,
        coverImage: null,
        coverImagePreview: book.volumeInfo.imageLinks?.thumbnail?.replace('http://', 'https://') || '',
        pages: book.volumeInfo.pageCount || '',
        category: detectCategory(book.volumeInfo.categories || [])
      }));

      // Vérifier la disponibilité
      checkAvailability(title, author, book.volumeInfo.publishedDate);

      // Basculer sur le formulaire manuel pour permettre les modifications
      setSearchMode('manual');
    }

    return true;
  }, [existingRequests, checkAvailability, targetUserId]);

  const handleTargetUserChange = (e) => {
    const userId = e.target.value;
    setTargetUserId(userId);
    fetchQuota(userId);
    setShelfPickerOpen(false);

    // Le nouveau propriétaire ne doit pas rester coché comme cible additionnelle.
    setExtraShelfSelections(prev => {
      if (!userId || !prev[userId]) return prev;
      const { [userId]: _omit, ...rest } = prev;
      return rest;
    });

    if (userId) {
      // Étagères du user cible, plutôt que de désactiver le picker comme avant —
      // reconstitué depuis /calibre/shelf-targets (l'admin n'a pas accès au
      // compte du user cible directement).
      const target = shelfTargetUsers.find(u => u._id === userId);
      if (target) {
        setCalibreEnabled(true);
        setCalibreShelves(target.shelves || []);
        setSelectedShelves((target.shelves || []).filter(s => s.isDefault).map(s => s.name));
      } else {
        setCalibreEnabled(false);
        setCalibreShelves([]);
        setSelectedShelves([]);
      }
    } else {
      // Retour à soi-même : recharger sa propre config Calibre-Web.
      fetchCalibreShelves();
    }
  };

  const handleRemoveBook = () => {
    setSelectedBook(null);
    setRawPublishedDate('');
    setSeriesInfo(null);
    setAvailability(null);
    setSearchMode('google'); // Retour à la recherche avec les résultats précédents
    setForm(prev => ({
      ...prev,
      title: '',
      author: '',
      year: '',
      genre: '',
      description: '',
      coverImage: null,
      coverImagePreview: '',
      file: null
    }));

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Validation des champs requis
    if (!form.title || !form.author) {
      setMessage({ 
        text: 'Veuillez remplir tous les champs obligatoires', 
        type: 'error' 
      });
      return;
    }
    
    setIsSubmitting(true);
    setMessage({ text: '', type: '' });
    
    // Créer un objet avec les données du formulaire
    const requestData = {
      title: form.title,
      author: form.author,
      description: form.description || '',
      link: form.link || '',
      thumbnail: form.coverImagePreview || '',
      pageCount: 0,
      publishedDate: rawPublishedDate || (form.year ? frToIso(String(form.year)) : ''),
      format: form.format || '',
      category: form.category || 'ebook',
      ...(selectedBook?.id && { googleBooksId: selectedBook.id }),
      ...(isAdmin && targetUserId && { targetUserId }),
      ...(seriesInfo && { seriesName: seriesInfo.name, seriesIndex: seriesInfo.index }),
      ...(calibreEnabled && { selectedShelves }),
      ...(isAdmin && Object.keys(extraShelfSelections).length && {
        extraShelfTargets: Object.entries(extraShelfSelections)
          .filter(([, shelves]) => shelves.length)
          .map(([userId, shelves]) => ({ userId, shelves })),
      }),
    };
    
    // Validation date de sortie (obligatoire en mode manuel)
    if (!selectedBook && !form.year?.toString().trim()) {
      setMessage({
        text: 'Veuillez renseigner la date de sortie du livre.',
        type: 'error'
      });
      setIsSubmitting(false);
      return;
    }

    // Validation du format de la date (format français : AAAA, MM/AAAA ou JJ/MM/AAAA)
    if (form.year && !/^(\d{2}\/\d{2}\/\d{4}|\d{2}\/\d{4}|\d{4})$/.test(String(form.year).trim())) {
      setMessage({
        text: 'Format de date invalide. Utilisez : 2024, 06/2024 ou 15/06/2024.',
        type: 'error'
      });
      setIsSubmitting(false);
      return;
    }

    // Validation du lien
    if (!form.link) {
      setMessage({ 
        text: 'Veuillez fournir un lien vers le livre (Amazon, Fnac, etc.)', 
        type: 'error' 
      });
      setIsSubmitting(false);
      return;
    }
    
    try {
      // Valider que c'est une URL valide
      new URL(form.link);
    } catch (e) {
      setMessage({ 
        text: 'Veuillez fournir une URL valide (commençant par http:// ou https://)', 
        type: 'error' 
      });
      setIsSubmitting(false);
      return;
    }
    
    // Si on a une image de couverture depuis Google Books
    if (form.coverImagePreview && !form.coverImage) {
      requestData.thumbnail = form.coverImagePreview;
    }
    try {
      await axiosAdmin.post('/api/requests', requestData);
      await fetchQuota(isAdmin && targetUserId ? targetUserId : '');
      setMessage({
        text: 'Votre demande a été soumise avec succès !',
        type: 'success'
      });

      // Si série détectée, ouvrir la modal avant de rediriger
      if (seriesInfo) {
        setSubmittedBook({ ...requestData, googleBooksId: selectedBook?.id });
        setSeriesModal(true);
      }

      // Réinitialiser le formulaire
      setForm({
        title: '',
        author: '',
        year: '',
        genre: '',
        description: '',
        coverImage: null,
        coverImagePreview: '',
        file: null
      });

      setSelectedBook(null);
      setRawPublishedDate('');
      setSeriesInfo(null);

      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      // Rediriger vers le tableau de bord après 2 secondes (sauf si modal série ouverte)
      if (!seriesInfo) {
        setTimeout(() => {
          navigate('/dashboard');
        }, 2000);
      }
      
    } catch (err) {
      console.error('Erreur lors de la soumission de la demande:', err);
      setMessage({
        text: err.response?.data?.error || err.response?.data?.message || 'Une erreur est survenue lors de la soumission de la demande',
        type: 'error'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBatchSelectBooks = useCallback(async (books) => {
    if (!books?.length) return;
    setIsSubmitting(true);
    setMessage({ text: '', type: '' });
    setBatchProgress({ current: 0, total: books.length });

    let ok = 0;
    let skipped = 0;
    const errors = [];

    for (let i = 0; i < books.length; i++) {
      const book   = books[i];
      const title  = book.volumeInfo?.title || '';
      const author = book.volumeInfo?.authors?.[0] || '';

      setBatchProgress({ current: i + 1, total: books.length });

      if (!title || !author) { skipped++; continue; }

      const isDuplicate = existingRequests.some(req =>
        req.googleBooksId === book.id ||
        (req.title === title && req.author === author)
      );
      if (isDuplicate) { skipped++; continue; }

      try {
        await axiosAdmin.post('/api/requests', {
          title,
          author: book.volumeInfo.authors?.join(', ') || author,
          description: book.volumeInfo.description || '',
          link: book.volumeInfo.infoLink || `https://books.google.fr/books?id=${book.id}`,
          thumbnail: book.volumeInfo.imageLinks?.thumbnail || '',
          publishedDate: book.volumeInfo.publishedDate || '',
          category: 'ebook',
          googleBooksId: book.id,
          ...(isAdmin && targetUserId && { targetUserId }),
        });
        ok++;
      } catch (err) {
        errors.push(title);
      }
    }

    await fetchQuota(isAdmin && targetUserId ? targetUserId : '');

    const parts = [];
    if (ok > 0) parts.push(`${ok} demande${ok > 1 ? 's' : ''} soumise${ok > 1 ? 's' : ''}`);
    if (skipped > 0) parts.push(`${skipped} ignorée${skipped > 1 ? 's' : ''} (doublon ou données manquantes)`);
    if (errors.length > 0) parts.push(`${errors.length} erreur${errors.length > 1 ? 's' : ''}`);

    setMessage({
      text: parts.join(' · '),
      type: errors.length > 0 && ok === 0 ? 'error' : 'success',
    });

    setBatchProgress(null);
    setIsSubmitting(false);
  }, [existingRequests, isAdmin, targetUserId]);

  // Cibles additionnelles disponibles pour le multishelf multi-utilisateurs
  // (admin uniquement) — tous les comptes Calibre-Web activés sauf celui du
  // propriétaire actuel de la demande (self ou targetUserId).
  const currentOwnerUsername = targetUserId
    ? users.find(u => u._id === targetUserId)?.username
    : localStorage.getItem('username');
  const extraTargetCandidates = isAdmin
    ? shelfTargetUsers.filter(u => u.username !== currentOwnerUsername)
    : [];
  const extraShelfCount = Object.values(extraShelfSelections).reduce((n, arr) => n + arr.length, 0);

  if (!isAuthenticated) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.loadingSpinner}></div>
        <p>Vérification de l'authentification...</p>
      </div>
    );
  }

  const isPublishedInFuture = (dateStr) => {
    if (!dateStr) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const parts = dateStr.split('-');
    let d;
    if (parts.length === 1) d = new Date(parseInt(parts[0]), 0, 1);
    else if (parts.length === 2) d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1);
    else d = new Date(dateStr);
    return !isNaN(d.getTime()) && d > today;
  };

  const availabilityConf = availability?.confidence;
  const availabilityMeta = {
    high:    { label: 'Disponibilité rapide',   icon: '✓', cls: styles.availabilityHigh },
    medium:  { label: 'Disponibilité probable', icon: '⚡', cls: styles.availabilityMedium },
    low:     { label: 'Traitement standard',    icon: '⏱', cls: styles.availabilityLow },
    unknown: { label: 'Disponibilité inconnue', icon: '?', cls: styles.availabilityUnknown },
  };

  return (
    <>
    <div className={styles.pageWrapper}>
    <h1 className={styles.pageTitle}>Demander un livre</h1>
    <div className={`${styles.formContainer} ${styles.requestForm}`}>
      <div className={styles.formCard}>

      {/* ── Quota compact ── */}
      {valentineQuota && !valentineQuota.error && (
        <div className={styles.quotaBar}>
          <span className={styles.quotaBarLabel} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <img src="https://valentine.wtf/logo.php?mode=clair" alt="Valentine"
              style={{ height: '11px', width: 'auto', filter: 'brightness(0) saturate(100%) invert(48%) sepia(98%) saturate(400%) hue-rotate(200deg) brightness(80%)' }} />
            Valentine
          </span>
          {valentineQuota.total != null && (
            <div className={styles.quotaBarTrack}>
              <div className={`${styles.quotaBarFill} ${valentineQuota.remaining === 0 ? styles.quotaBarEmpty : valentineQuota.remaining <= 5 ? styles.quotaBarLow : styles.quotaBarOk}`}
                style={{ width: `${Math.round(((valentineQuota.total - valentineQuota.remaining) / valentineQuota.total) * 100)}%` }} />
            </div>
          )}
          <span className={`${styles.quotaBarCount} ${valentineQuota.remaining === 0 ? styles.quotaCountEmpty : valentineQuota.remaining <= 5 ? styles.quotaCountLow : styles.quotaCountOk}`}>
            {valentineQuota.remaining ?? '—'}{valentineQuota.total != null && ` / ${valentineQuota.total}`} restant{valentineQuota.remaining > 1 ? 's' : ''}
          </span>
        </div>
      )}
      {quota && (
        <div className={styles.quotaBar}>
          <span className={styles.quotaBarLabel}>
            {quota.used} demande{quota.used > 1 ? 's' : ''} utilisée{quota.used > 1 ? 's' : ''}
            {' '}sur {quota.days ?? 30} jours
            {isAdmin && targetUserId && users.find(u => u._id === targetUserId) && (
              <span style={{ color: 'var(--color-accent)', marginLeft: '0.4rem' }}>
                · {users.find(u => u._id === targetUserId).username}
              </span>
            )}
          </span>
          <div className={styles.quotaBarTrack}>
            <div className={`${styles.quotaBarFill} ${quota.unlimited ? styles.quotaBarUnlimited : quota.remaining === 0 ? styles.quotaBarEmpty : quota.remaining <= 2 ? styles.quotaBarLow : styles.quotaBarOk}`}
              style={{ width: quota.unlimited ? '100%' : `${Math.round((quota.used / quota.limit) * 100)}%` }} />
          </div>
          <span className={`${styles.quotaBarCount} ${quota.unlimited ? styles.quotaCountUnlimited : quota.remaining === 0 ? styles.quotaCountEmpty : quota.remaining <= 2 ? styles.quotaCountLow : styles.quotaCountOk}`}>
            {quota.unlimited ? '∞ Illimité' : `${quota.remaining} / ${quota.limit} restante${quota.remaining > 1 ? 's' : ''}`}
          </span>
        </div>
      )}

      {/* ── Ligne du haut : sélecteur user + toggle mode ── */}
      <div className={styles.formTopRow}>
        <div className={styles.toggleSearch}>
          <button type="button"
            className={`${styles.toggleButton} ${searchMode === 'google' ? styles.toggleActive : ''}`}
            onClick={() => setSearchMode('google')} disabled={!!selectedBook} aria-pressed={searchMode === 'google'}>
            <SearchIcon /> Rechercher
          </button>
          <button type="button"
            className={`${styles.toggleButton} ${searchMode === 'manual' ? styles.toggleActive : ''}`}
            onClick={() => setSearchMode('manual')} aria-pressed={searchMode === 'manual'}>
            <EditIcon /> Manuel
          </button>
        </div>

        {isAdmin && users.length > 0 && (
          <div className={styles.adminUserSelect}>
            <label className={styles.adminUserSelectLabel}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
              Soumettre pour
            </label>
            <select
              value={targetUserId}
              onChange={handleTargetUserChange}
              className={styles.adminUserSelectInput}
            >
              <option value="">{localStorage.getItem('username') || 'Mon compte'}</option>
              {users.filter(u => u.role !== 'admin').map(u => (
                <option key={u._id} value={u._id}>{u.username}{u.email ? ` — ${u.email}` : ''}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {message.text && (
        <div className={`${styles.message} ${message.type === 'error' ? styles.error : styles.success}`}>
          {message.text}
        </div>
      )}

      {/* ── Contenu ── */}

      {/* GoogleBooksSearch toujours monté pour préserver les résultats */}
      <div style={{ display: searchMode === 'google' && !selectedBook ? 'block' : 'none' }}>
        <GoogleBooksSearch onSelectBook={handleBookSelect} onBatchSelectBooks={handleBatchSelectBooks} batchSubmitting={isSubmitting} batchProgress={batchProgress} onSwitchToManual={() => setSearchMode('manual')} />
      </div>

      {searchMode === 'google' && selectedBook && (
        <SelectedBookInfo book={selectedBook} onRemove={handleRemoveBook} />
      )}

      {searchMode === 'manual' && (
        <form onSubmit={handleSubmit} className={styles.form}>
          {selectedBook && <SelectedBookInfo book={selectedBook} onRemove={handleRemoveBook} />}

          {checkingAvailability && (
            <div className={styles.availabilityCheck}>
              <div className={styles.availabilitySpinner}></div>
              <span>Vérification de la disponibilité…</span>
            </div>
          )}
          {availability && !checkingAvailability && availabilityConf && (
            <div className={`${styles.availabilityBadge} ${availabilityMeta[availabilityConf]?.cls}`}>
              <span className={styles.availabilityBadgeIcon}>{availabilityMeta[availabilityConf]?.icon}</span>
              <div>
                <div className={styles.availabilityTitle}>{availabilityMeta[availabilityConf]?.label}</div>
                <div className={styles.availabilityMessage}>{availability.message}</div>
                {availability.sources?.length > 0 && (
                  <div className={styles.availabilitySource}>Trouvé via : {availability.sources.join(' · ')}</div>
                )}
              </div>
            </div>
          )}
          {rawPublishedDate && isPublishedInFuture(rawPublishedDate) && (
            <div className={`${styles.availabilityBadge} ${styles.availabilityLow}`}>
              <span className={styles.availabilityBadgeIcon}>📅</span>
              <div>
                <div className={styles.availabilityTitle}>Livre pas encore sorti</div>
                <div className={styles.availabilityMessage}>
                  Date de sortie : <strong>{isoToFr(rawPublishedDate)}</strong>. Le téléchargement automatique démarrera à partir de cette date.
                </div>
              </div>
            </div>
          )}
          {seriesInfo && (
            <div className={`${styles.availabilityBadge} ${styles.availabilityFast}`}>
              <span className={styles.availabilityBadgeIcon}>📚</span>
              <div>
                <div className={styles.availabilityTitle}>Série détectée</div>
                <div className={styles.availabilityMessage}>
                  <strong>{seriesInfo.name}</strong>{seriesInfo.index ? ` — Tome ${seriesInfo.index}` : ''}. Après soumission, vous pourrez demander les autres tomes.
                </div>
              </div>
            </div>
          )}


          <div className={styles.formRow}>
            <div className={`${styles.formGroup} ${styles.halfWidth}`}>
              <label htmlFor="title" className={styles.label}>Titre <span className={styles.required}>*</span></label>
              <input type="text" id="title" name="title" value={form.title}
                onChange={handleChange} className={styles.input} placeholder="Titre du livre" required />
            </div>
            <div className={`${styles.formGroup} ${styles.halfWidth}`}>
              <label htmlFor="author" className={styles.label}>Auteur(s) <span className={styles.required}>*</span></label>
              <input type="text" id="author" name="author" value={form.author}
                onChange={handleChange} className={styles.input} placeholder="Nom de l'auteur" required />
            </div>
          </div>

          <div className={styles.formRow}>
            <div className={`${styles.formGroup} ${styles.halfWidth}`}>
              <label htmlFor="year" className={styles.label}>Date de sortie {!selectedBook && <span className={styles.required}>*</span>}</label>
              <input type="text" id="year" name="year" value={form.year || ''}
                onChange={handleChange} className={styles.input} placeholder="2024, 06/2024 ou 15/06/2024"
                required={!selectedBook} />
            </div>
            <div className={`${styles.formGroup} ${styles.halfWidth}`}>
              <label htmlFor="genre" className={styles.label}>Genre</label>
              <input type="text" id="genre" name="genre" value={form.genre || ''}
                onChange={handleChange} className={styles.input} placeholder="Roman, BD, SF…" />
            </div>
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="description" className={styles.label}>Description</label>
            <textarea id="description" name="description" value={form.description || ''}
              onChange={handleChange} className={`${styles.input} ${styles.textarea}`}
              placeholder="Description du livre…" rows="3" />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="link" className={styles.label}>
              Lien (Amazon, Fnac…) <span className={styles.required}>*</span>
            </label>
            <input type="url" id="link" name="link" value={form.link || ''}
              onChange={handleChange} className={styles.input}
              placeholder="https://www.amazon.fr/…" required />
          </div>

          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label className={styles.label}>Format</label>
              <select
                className={styles.input}
                value={form.format}
                onChange={e => {
                  const fmt = e.target.value;
                  const autoCategory = ['cbz', 'cbr', 'pdf'].includes(fmt) ? 'comic'
                    : ['epub', 'mobi', 'azw3', 'fb2'].includes(fmt) ? 'ebook'
                    : null;
                  setForm(prev => ({ ...prev, format: fmt, ...(autoCategory ? { category: autoCategory } : {}) }));
                }}
              >
                <optgroup label="Ebook">
                  <option value="epub">EPUB</option>
                  <option value="mobi">MOBI</option>
                  <option value="azw3">AZW3 (Kindle)</option>
                  <option value="fb2">FB2</option>
                </optgroup>
                <optgroup label="Comic / BD / Manga">
                  <option value="cbz">CBZ</option>
                  <option value="cbr">CBR</option>
                  <option value="pdf">PDF</option>
                </optgroup>
              </select>
            </div>
            <div className={styles.formGroup}>
              <label className={styles.label}>Type de livre</label>
              <select
                className={styles.input}
                value={form.category}
                onChange={e => setForm(prev => ({ ...prev, category: e.target.value }))}
              >
                <option value="ebook">Roman / Essai</option>
                <option value="manga">Manga</option>
                <option value="comic">Comic / BD</option>
              </select>
            </div>
            <div className={styles.formGroup} style={{ flex: 1 }}>
              <label className={styles.label}>
                Couverture <span className={styles.optionalLabel}>(optionnel)</span>
              </label>
              <input type="file" id="coverImage" name="coverImage" accept="image/*"
                onChange={handleChange} className={styles.fileInputHidden}
                ref={fileInputRef} />
              <label htmlFor="coverImage" className={styles.coverImageBtn}>
                {form.coverImagePreview ? (
                  <img src={form.coverImagePreview} alt="Aperçu" className={styles.coverImageThumb} />
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
                      <path d="m21 15-5-5L5 21"/>
                    </svg>
                    <span>Choisir une image</span>
                  </>
                )}
              </label>
              <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: '0.3rem', display: 'block' }}>Recommandé : 200 × 300 px</span>
            </div>
          </div>

          <div className={styles.formActions} style={{ position: 'relative' }}>
            {(calibreEnabled || extraTargetCandidates.length > 0) && (
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => setShelfPickerOpen(o => !o)}
                  className={styles.cancelButton}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
                  title="Choisir les étagères Calibre-Web pour ce livre"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 3v18h18" /><path d="M3 8h18" /><path d="M3 13h18" /><path d="M3 18h18" />
                  </svg>
                  Étagères{(selectedShelves.length + extraShelfCount) ? ` (${selectedShelves.length + extraShelfCount})` : ''}
                </button>
                {shelfPickerOpen && (
                  <div
                    style={{
                      position: 'absolute', bottom: '100%', left: 0, marginBottom: '0.5rem',
                      background: 'var(--color-bg3)', border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius)', padding: '0.75rem', minWidth: 240,
                      maxHeight: '60vh', overflowY: 'auto',
                      zIndex: 20, boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
                    }}
                  >
                    {calibreEnabled && (<>
                      <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--color-text-muted)' }}>
                        Envoyer ce livre vers :
                      </div>
                      {calibreShelves.map(s => (
                        <label key={s.name} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.3rem 0', fontSize: '0.85rem', cursor: 'pointer' }}>
                          <input type="checkbox" checked={selectedShelves.includes(s.name)} onChange={() => toggleShelf(s.name)} />
                          {s.name}
                        </label>
                      ))}
                    </>)}
                    {extraTargetCandidates.length > 0 && (
                      <div style={{ marginTop: calibreEnabled ? '0.6rem' : 0, paddingTop: calibreEnabled ? '0.6rem' : 0, borderTop: calibreEnabled ? '1px solid var(--color-border)' : 'none' }}>
                        <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.4rem', color: 'var(--color-text-muted)' }}>
                          Aussi pour :
                        </div>
                        {extraTargetCandidates.map(u => (
                          <div key={u._id} style={{ marginBottom: '0.4rem' }}>
                            <div style={{ fontSize: '0.8rem', fontWeight: 500, marginBottom: '0.15rem' }}>{u.username}</div>
                            {(u.shelves || []).length === 0 ? (
                              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', paddingLeft: '0.5rem' }}>Aucune étagère configurée</div>
                            ) : u.shelves.map(s => (
                              <label key={s.name} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.2rem 0 0.2rem 0.5rem', fontSize: '0.82rem', cursor: 'pointer' }}>
                                <input
                                  type="checkbox"
                                  checked={(extraShelfSelections[u._id] || []).includes(s.name)}
                                  onChange={() => toggleExtraShelf(u._id, s.name)}
                                />
                                {s.name}
                              </label>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setShelfPickerOpen(false)}
                      style={{ marginTop: '0.5rem', fontSize: '0.78rem', background: 'none', border: 'none', color: 'var(--color-accent, #a78bfa)', cursor: 'pointer', padding: 0 }}
                    >
                      Fermer
                    </button>
                  </div>
                )}
              </div>
            )}
            <button type="submit" className={styles.submitButton}
              disabled={isSubmitting || (quota && quota.remaining === 0)} aria-busy={isSubmitting}>
              {isSubmitting ? 'Soumission en cours…'
                : quota?.remaining === 0 ? 'Limite de demandes atteinte'
                : 'Soumettre la demande'}
            </button>
            {selectedBook && (
              <button type="button" className={styles.cancelButton} onClick={handleRemoveBook} disabled={isSubmitting}>
                Annuler
              </button>
            )}
          </div>
        </form>
      )}

      </div>
      <BookRecommendations onSelectBook={handleBookSelect} />
    </div>
    </div>

    {seriesModal && submittedBook && (
      <SeriesModal
        seriesName={submittedBook.seriesName}
        currentBookId={submittedBook.googleBooksId}
        currentBook={submittedBook}
        existingRequests={existingRequests}
        quotaRemaining={quota?.unlimited ? Infinity : (quota?.remaining ?? Infinity)}
        onClose={() => { setSeriesModal(false); navigate('/dashboard'); }}
        onSubmitted={() => fetchQuota(isAdmin && targetUserId ? targetUserId : '')}
      />
    )}
    </>
  );
}

export default UserForm;