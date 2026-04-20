import express from 'express';
import User from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Mettre à jour la dernière activité de l'utilisateur
router.post('/', requireAuth, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { lastActivity: new Date() },
      { new: true }
    ).select('-password -__v');
    
    res.json({ success: true, lastActivity: user.lastActivity });
  } catch (error) {
    console.error('Erreur lors de la mise à jour de l\'activité:', error);
    res.status(500).json({ error: 'Erreur serveur lors de la mise à jour de l\'activité' });
  }
});

export default router;