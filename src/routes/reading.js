import express from 'express';
import ReadingList from '../models/ReadingList.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// GET — liste de lecture de l'utilisateur
router.get('/', requireAuth, async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { userId: req.user.id };
    if (status && status !== 'all') filter.status = status;

    const books = await ReadingList.find(filter).sort({ createdAt: -1 });
    res.json(books);
  } catch (error) {
    console.error('Erreur lecture liste:', error);
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

    // Vérifier doublon manuel (même titre + auteur pour cet utilisateur)
    const existing = await ReadingList.findOne({
      userId: req.user.id,
      title: { $regex: new RegExp(`^${title.trim()}$`, 'i') },
      author: { $regex: new RegExp(`^${author.trim()}$`, 'i') },
    });
    if (existing) {
      return res.status(409).json({ message: 'Ce livre est déjà dans votre liste' });
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

    const { status, rating } = req.body;
    if (status !== undefined) {
      book.status = status;
      book.readAt = status === 'read' ? new Date() : null;
    }
    if (rating !== undefined) {
      book.rating = Math.min(5, Math.max(0, Number(rating)));
    }
    await book.save();

    res.json(book);
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