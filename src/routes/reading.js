import express from 'express';
import ReadingList from '../models/ReadingList.js';
import User from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';
import { syncReadingEntryToHardcover } from '../services/hardcoverSyncService.js';

const router = express.Router();

// GET — liste de lecture de l'utilisateur
router.get('/', requireAuth, async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { userId: req.user.id };
    if (status && status !== 'all') filter.status = status;

    const books = await ReadingList.find(filter)
      .populate('requestId', 'downloadLink filePath status author')
      .sort({ createdAt: -1 });
    res.json(books);
  } catch (error) {
    console.error('Erreur lecture liste:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// Échappe une valeur pour l'insérer dans un champ CSV (RFC 4180) : entoure de
// guillemets et double les guillemets internes dès qu'un caractère spécial
// (virgule, guillemet, retour à la ligne) est présent.
function csvField(value) {
  const s = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// GET /export — export CSV de la bibliothèque de lecture de l'utilisateur.
// Pas de dépendance externe : le format reste simple (une ligne par livre,
// colonnes fixes), un générateur maison suffit.
router.get('/export', requireAuth, async (req, res) => {
  try {
    const [user, books] = await Promise.all([
      User.findById(req.user.id).select('username'),
      ReadingList.find({ userId: req.user.id }).sort({ createdAt: -1 }).lean(),
    ]);

    const columns = ['Titre', 'Auteur', 'Statut', 'Note', 'Date de lecture', 'Notes personnelles', 'Origine', 'Ajouté le'];
    const rows = books.map(b => [
      b.title,
      b.author,
      b.status === 'read' ? 'Lu' : 'Non lu',
      b.rating || '',
      b.readAt ? new Date(b.readAt).toISOString().slice(0, 10) : '',
      b.notes || '',
      b.importedFrom === 'hardcover' ? 'Hardcover' : (b.source === 'request' ? 'Demande' : 'Manuel'),
      new Date(b.createdAt).toISOString().slice(0, 10),
    ]);

    const csv = [columns, ...rows].map(row => row.map(csvField).join(',')).join('\r\n');

    res.setHeader('Content-Disposition', `attachment; filename="ebookrequest-bibliotheque-${user?.username || req.user.id}.csv"`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.send('﻿' + csv); // BOM pour un affichage correct des accents dans Excel
  } catch (error) {
    console.error('Erreur export bibliothèque:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// POST — ajouter un livre manuellement
router.post('/', requireAuth, async (req, res) => {
  try {
    const { title, author, thumbnail, googleBooksId } = req.body;
    if (!title || !author) {
      return res.status(400).json({ message: 'Titre et auteur requis' });
    }

    // Vérifier doublon : d'abord par googleBooksId (plus fiable), puis par titre+auteur
    const orConditions = [
      {
        title:  { $regex: new RegExp(`^${title.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        author: { $regex: new RegExp(`^${author.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      },
    ];
    if (googleBooksId) orConditions.unshift({ googleBooksId });

    const existing = await ReadingList.findOne({ userId: req.user.id, $or: orConditions });
    if (existing) {
      return res.status(409).json({ message: 'Ce livre est déjà dans votre bibliothèque' });
    }

    const book = await ReadingList.create({
      userId: req.user.id,
      title: title.trim(),
      author: author.trim(),
      thumbnail: thumbnail || '',
      googleBooksId: googleBooksId || '',
      source: 'manual',
      // requestId volontairement absent pour les ajouts manuels
      // (l'index sparse { userId, requestId } ne s'applique que quand requestId est défini)
    });

    // Synchro Hardcover en tâche de fond — ne doit jamais retarder/bloquer la réponse
    syncReadingEntryToHardcover(req.user.id, book).catch(() => {});

    res.status(201).json(book);
  } catch (error) {
    console.error('Erreur ajout livre:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// PUT — basculer statut lu/non lu
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const book = await ReadingList.findOne({ _id: req.params.id, userId: req.user.id });
    if (!book) return res.status(404).json({ message: 'Livre non trouvé' });

    const { status, rating, epubLocation, readingProgress, notes, thumbnail } = req.body;
    const wasUnstarted = book.readingProgress === 0;
    if (status !== undefined) {
      book.status = status;
      book.readAt = status === 'read' ? new Date() : null;
    }
    if (rating !== undefined) {
      book.rating = Math.min(5, Math.max(0, Number(rating)));
    }
    if (epubLocation !== undefined) book.epubLocation = epubLocation;
    if (readingProgress !== undefined) book.readingProgress = Math.min(100, Math.max(0, Number(readingProgress)));
    if (notes !== undefined) book.notes = notes.trim();
    if (thumbnail !== undefined) book.thumbnail = thumbnail;
    await book.save();

    // Synchro Hardcover : on attend le résultat (appel unique, rapide) pour pouvoir
    // informer l'utilisateur en cas d'échec, sans jamais faire échouer la requête.
    // syncReadingEntryToHardcover persiste elle-même hardcoverSync en DB ; on reconstruit
    // ici la même valeur pour la renvoyer directement (évite un aller-retour DB en plus).
    // Déclenchée sur statut/note, ou au premier passage à une progression > 0 (bascule
    // "à lire" → "en cours" côté Hardcover) — pas à chaque mise à jour de position de
    // lecture, bien trop fréquente pour le rate-limit Hardcover.
    const justStartedReading = wasUnstarted && book.readingProgress > 0;
    let hardcoverSync = null;
    let hardcoverSyncField = book.hardcoverSync;
    if (status !== undefined || rating !== undefined || justStartedReading) {
      hardcoverSync = await syncReadingEntryToHardcover(req.user.id, book).catch(() => null);
      if (hardcoverSync?.attempted) {
        hardcoverSyncField = {
          status: hardcoverSync.success ? 'synced' : 'error',
          syncedAt: new Date(),
          error: hardcoverSync.error || '',
        };
      }
    }

    res.json({
      ...book.toObject(),
      hardcoverSync: hardcoverSyncField,
      _hardcoverSync: hardcoverSync?.attempted ? hardcoverSync : undefined,
    });
  } catch (error) {
    console.error('Erreur mise à jour statut:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

// DELETE — retirer un livre
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const book = await ReadingList.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    if (!book) return res.status(404).json({ message: 'Livre non trouvé' });
    res.json({ message: 'Livre retiré de la liste' });
  } catch (error) {
    console.error('Erreur suppression livre:', error);
    res.status(500).json({ message: 'Erreur serveur' });
  }
});

export default router;