import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import axiosAdmin from '../../axiosAdmin';
import GoogleBooksSearch from '../../components/GoogleBooksSearch';
import BookRecommendations from '../../components/BookRecommendations';
import { compressImage, isImage } from '../../utils/imageCompressor';
import styles from './UserForm.module.css';

const SwapIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 16V4m0 0L3 8m4-4l4 4"/><path d="M17 8v12m0 0l4-4m-4 4l-4-4"/>
  </svg>
);

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
      <button
        type="button"
        onClick={onRemove}
        className={styles.removeButton}
        aria-label="Changer de livre"
        title="Changer de livre"
      >
        <SwapIcon />
        <span>Changer</span>
      </button>
    </div>
  );
};

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
    format: ''
  });
  const [message, setMessage] = useState({ text: '', type: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [searchMode, setSearchMode] = useState('google');
  const [selectedBook, setSelectedBook] = useState(null);
  const [existingRequests, setExistingRequests] = useState([]);
  const [availability, setAvailability] = useState(null);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [quota, setQuota] = useState(null);

  // Fonction pour vérifier la disponibilité du livre
  const checkAvailability = useCallback(async (title, author) => {
    if (!title || !author) return;

    setCheckingAvailability(true);
    setAvailability(null);

    try {
      const response = await axiosAdmin.post('/api/availability/check', {
        title,
        author
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
      const token = localStorage.getItem('token');
      if (!token) {
        if (isMounted) {
          navigate('/login', { state: { from: '/' } });
        }
      } else {
        if (isMounted) {
          setIsAuthenticated(true);
          await Promise.all([fetchExistingRequests(), fetchQuota()]);

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

            // Vérifier la disponibilité si on a un titre et un auteur
            if (prefill.title && prefill.author) {
              checkAvailability(prefill.title, prefill.author);
            }
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
  
  // Charger le quota de l'utilisateur
  const fetchQuota = async () => {
    try {
      const response = await axiosAdmin.get('/api/requests/quota');
      setQuota(response.data);
    } catch (error) {
      console.error('Erreur lors du chargement du quota:', error);
    }
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

  const handleBookSelect = useCallback((book) => {
    if (!book) return false;

    // Vérifie si ce livre a déjà été demandé
    if (book.id) {
      const currentRequests = [...existingRequests];

      const isDuplicate = currentRequests.some(req => {
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
    setSelectedBook(book);

    // Mettre à jour le formulaire avec les informations du livre
    if (book.volumeInfo) {
      // Construire l'URL Google Books si elle n'est pas fournie
      const googleBooksLink = book.volumeInfo.infoLink || `https://books.google.fr/books?id=${book.id}`;

      const title = book.volumeInfo.title || '';
      const author = book.volumeInfo.authors?.[0] || '';

      setForm(prev => ({
        ...prev,
        title: title,
        author: book.volumeInfo.authors?.join(', ') || '',
        year: book.volumeInfo.publishedDate ? new Date(book.volumeInfo.publishedDate).getFullYear() : '',
        description: book.volumeInfo.description || '',
        link: googleBooksLink,
        coverImage: null,
        coverImagePreview: book.volumeInfo.imageLinks?.thumbnail?.replace('http://', 'https://') || '',
        pages: book.volumeInfo.pageCount || ''
      }));

      // Vérifier la disponibilité
      checkAvailability(title, author);

      // Basculer sur le formulaire manuel pour permettre les modifications
      setSearchMode('manual');
    }

    return true;
  }, [existingRequests, checkAvailability]); // Dépendances nécessaires pour le callback

  const handleRemoveBook = () => {
    setSelectedBook(null);
    setAvailability(null);
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
      format: form.format || '',
      ...(selectedBook?.id && { googleBooksId: selectedBook.id })
    };
    
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
      await fetchQuota();
      setMessage({
        text: 'Votre demande a été soumise avec succès !',
        type: 'success'
      });
      
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
      
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      
      // Rediriger vers le tableau de bord après 2 secondes
      setTimeout(() => {
        navigate('/dashboard');
      }, 2000);
      
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

  if (!isAuthenticated) {
    return (
      <div className={styles.loadingContainer}>
        <div className={styles.loadingSpinner}></div>
        <p>Vérification de l'authentification...</p>
      </div>
    );
  }

  const availabilityConf = availability?.confidence;
  const availabilityMeta = {
    high:    { label: 'Disponibilité rapide',   icon: '✓', cls: styles.availabilityHigh },
    medium:  { label: 'Disponibilité probable', icon: '⚡', cls: styles.availabilityMedium },
    low:     { label: 'Traitement standard',    icon: '⏱', cls: styles.availabilityLow },
    unknown: { label: 'Disponibilité inconnue', icon: '?', cls: styles.availabilityUnknown },
  };

  return (
    <div className={styles.pageWrapper}>
    <h1 className={styles.pageTitle}>Demander un livre</h1>
    <div className={`${styles.formContainer} ${styles.requestForm}`}>
      <div className={styles.formCard}>

      {/* ── Toggle ── */}
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

      {/* ── Quota compact ── */}
      {quota && (
        <div className={styles.quotaBar}>
          <span className={styles.quotaBarLabel}>
            {quota.used} demande{quota.used > 1 ? 's' : ''} utilisée{quota.used > 1 ? 's' : ''} sur 30 jours
          </span>
          <div className={styles.quotaBarTrack}>
            <div className={`${styles.quotaBarFill} ${quota.remaining === 0 ? styles.quotaBarEmpty : quota.remaining <= 2 ? styles.quotaBarLow : styles.quotaBarOk}`}
              style={{ width: `${quota.limit > 0 ? Math.round((quota.used / quota.limit) * 100) : 100}%` }} />
          </div>
          <span className={`${styles.quotaBarCount} ${quota.remaining === 0 ? styles.quotaCountEmpty : quota.remaining <= 2 ? styles.quotaCountLow : styles.quotaCountOk}`}>
            {quota.remaining} / {quota.limit} restante{quota.remaining > 1 ? 's' : ''}
          </span>
        </div>
      )}

      {message.text && (
        <div className={`${styles.message} ${message.type === 'error' ? styles.error : styles.success}`}>
          {message.text}
        </div>
      )}

      {/* ── Contenu ── */}
      {searchMode === 'google' ? (
        selectedBook ? (
          <SelectedBookInfo book={selectedBook} onRemove={handleRemoveBook} />
        ) : (
          <GoogleBooksSearch onSelectBook={handleBookSelect} />
        )
      ) : (
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
              <label htmlFor="author" className={styles.label}>Auteur(s) <span className="styles.required">*</span></label>
              <input type="text" id="author" name="author" value={form.author}
                onChange={handleChange} className={styles.input} placeholder="Nom de l'auteur" required />
            </div>
          </div>

          <div className={styles.formRow}>
            <div className={`${styles.formGroup} ${styles.halfWidth}`}>
              <label htmlFor="year" className={styles.label}>Année</label>
              <input type="number" id="year" name="year" value={form.year || ''}
                onChange={handleChange} className={styles.input} placeholder="2024"
                min="1000" max={new Date().getFullYear() + 1} />
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
              <label className={styles.label}>Format <span className={styles.optionalLabel}>(optionnel)</span></label>
              <div className={styles.formatButtons}>
                {['epub', 'pdf', 'mobi'].map(f => (
                  <button key={f} type="button"
                    className={`${styles.formatBtn} ${form.format === f ? styles.formatBtnActive : ''}`}
                    onClick={() => setForm(prev => ({ ...prev, format: prev.format === f ? '' : f }))}>
                    {f.toUpperCase()}
                  </button>
                ))}
              </div>
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
            </div>
          </div>

          <button type="submit" className={styles.submitButton}
            disabled={isSubmitting || (quota && quota.remaining === 0)} aria-busy={isSubmitting}>
            {isSubmitting ? 'Soumission en cours…'
              : quota?.remaining === 0 ? 'Limite de demandes atteinte'
              : 'Soumettre la demande'}
          </button>
        </form>
      )}

      </div>
      <BookRecommendations onSelectBook={handleBookSelect} />
    </div>
    </div>
  );
}

export default UserForm;