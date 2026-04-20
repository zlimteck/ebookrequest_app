import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { updateUserProfile, verifyEmail, getCurrentUser, changePassword, updateAvatar, getUserStats } from '../controllers/userController.js';

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

export default router;