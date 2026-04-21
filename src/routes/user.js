import express from 'express';
import crypto from 'crypto';
import { requireAuth } from '../middleware/auth.js';
import { updateUserProfile, verifyEmail, getCurrentUser, changePassword, updateAvatar, getUserStats } from '../controllers/userController.js';
import User from '../models/User.js';

const router = express.Router();

// Récupérer le profil de l'utilisateur connecté
router.get('/me', requireAuth, getCurrentUser);

// Stats du profil
router.get('/me/stats', requireAuth, getUserStats);

// Mettre à jour le profil utilisateur
router.put('/profile', requireAuth, updateUserProfile);

// Mettre à jour l'avatar (base64)
router.put('/avatar', requireAuth, updateAvatar);

// Vérifier l'email avec un token
router.get('/verify-email/:token', verifyEmail);

// Changer le mot de passe
router.put('/change-password', requireAuth, changePassword);

// GET /api/users/opds-token — get (or generate) the user's OPDS token
router.get('/opds-token', requireAuth, async (req, res) => {
  try {
    let user = await User.findById(req.user.id).select('opdsToken');
    if (!user.opdsToken) {
      const token = crypto.randomUUID();
      await User.updateOne({ _id: req.user.id }, { $set: { opdsToken: token } });
      user.opdsToken = token;
    }
    const baseUrl = process.env.FRONTEND_URL || '';
    res.json({
      success: true,
      token: user.opdsToken,
      feedUrl: `${baseUrl}/api/opds/${user.opdsToken}`
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/users/opds-token/regenerate — regenerate OPDS token
router.post('/opds-token/regenerate', requireAuth, async (req, res) => {
  try {
    const token = crypto.randomUUID();
    await User.updateOne({ _id: req.user.id }, { $set: { opdsToken: token } });
    const baseUrl = process.env.FRONTEND_URL || '';
    res.json({
      success: true,
      token,
      feedUrl: `${baseUrl}/api/opds/${token}`
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;