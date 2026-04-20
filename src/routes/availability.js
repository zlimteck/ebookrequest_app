import express from 'express';
import { checkBookAvailability } from '../services/rssService.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

router.post('/check', requireAuth, async (req, res) => {
  try {
    const { title, author } = req.body;

    if (!title || !author) {
      return res.status(400).json({
        success: false,
        message: 'Le titre et l\'auteur sont requis'
      });
    }

    const result = await checkBookAvailability(title, author);
    return res.json({ success: true, ...result });

  } catch (error) {
    console.error('Erreur lors de la vérification de disponibilité:', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur lors de la vérification de disponibilité',
      available: false,
      confidence: 'unknown'
    });
  }
});

export default router;
