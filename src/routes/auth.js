import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import User from '../models/User.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { sendPasswordResetEmail } from '../services/emailService.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

// Vérifier la validité du token
router.get('/check-token', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
    res.json({ user });
  } catch (error) {
    console.error('Erreur lors de la vérification du token:', error);
    res.status(500).json({ error: 'Erreur serveur lors de la vérification du token' });
  }
});

// Inscription (admin seulement)
router.post('/register', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username, password, role } = req.body;
    
    // Validation des champs
    if (!username || !password) {
      return res.status(400).json({ error: 'Tous les champs sont requis' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });
    }
    
    // Vérifier si l'utilisateur existe déjà
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: 'Ce nom d\'utilisateur est déjà utilisé' });
    }
    
    // Hacher le mot de passe
    const hash = await bcrypt.hash(password, 10);
    
    // Créer l'utilisateur
    const user = new User({ 
      username, 
      password: hash, 
      role: role || 'user' 
    });
    
    await user.save();
    
    // Ne pas renvoyer le mot de passe
    const userResponse = user.toObject();
    delete userResponse.password;
    
    res.status(201).json({
      success: true,
      message: 'Utilisateur créé avec succès',
      user: userResponse
    });
    
  } catch (err) {
    console.error('Erreur lors de la création de l\'utilisateur:', err);
    
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(val => val.message);
      return res.status(400).json({ error: messages.join('. ') });
    }
    
    if (err.code === 11000) {
      return res.status(400).json({ error: 'Ce nom d\'utilisateur est déjà utilisé' });
    }
    
    res.status(500).json({ error: 'Erreur lors de la création de l\'utilisateur' });
  }
});

// Connexion
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe requis.' });
    }
    
    // Récupérer l'utilisateur avec le mot de passe
    const user = await User.findOne({ username }).select('+password');
    
    if (!user) {
      return res.status(401).json({ error: 'Identifiants invalides.' });
    }
    
    const valid = await bcrypt.compare(password, user.password);

    if (!valid) {
      return res.status(401).json({ error: 'Identifiants invalides.' });
    }

    if (user.isActive === false) {
      return res.status(403).json({ error: 'Votre compte a été désactivé. Contactez un administrateur.' });
    }

    // Vérifier si le 2FA est activé
    if (user.twoFactor?.enabled) {
      const tempToken = jwt.sign(
        { id: user._id, scope: '2fa' },
        JWT_SECRET,
        { expiresIn: '5m' }
      );
      return res.json({ twoFactorRequired: true, tempToken });
    }

    // Mise à jour de la dernière connexion (updateOne évite le hook pre-save)
    await User.updateOne(
      { _id: user._id },
      { $set: { lastLogin: new Date(), lastActivity: new Date() } }
    );

    const token = jwt.sign({
      id: user._id,
      role: user.role
    }, JWT_SECRET, { expiresIn: '30d' });

    const userResponse = user.toObject();
    delete userResponse.password;

    res.json({
      token,
      role: user.role,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        lastLogin: user.lastLogin,
        lastActivity: user.lastActivity
      }
    });
  } catch (err) {
    console.error('Erreur lors de la connexion:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// Demande de réinitialisation de mot de passe
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requis.' });

    const user = await User.findOne({ email: email.toLowerCase().trim() });

    // Toujours répondre OK pour ne pas révéler si l'email existe
    if (!user) {
      return res.json({ message: 'Si cet email existe, un lien de réinitialisation a été envoyé.' });
    }

    // Anti-spam : interdire une nouvelle demande si un token récent existe (< 15 min)
    const COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes
    if (user.resetPasswordExpires && user.resetPasswordExpires > new Date(Date.now() + 60 * 60 * 1000 - COOLDOWN_MS)) {
      return res.status(429).json({
        error: 'Un lien de réinitialisation a déjà été envoyé récemment. Veuillez patienter 15 minutes avant de réessayer.'
      });
    }

    const token = crypto.randomBytes(32).toString('hex');
    // updateOne pour éviter le hook pre-save (pas de hachage accidentel du mot de passe)
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          resetPasswordToken: token,
          resetPasswordExpires: new Date(Date.now() + 60 * 60 * 1000), // 1h
        },
      }
    );

    await sendPasswordResetEmail(user.email, user.username, token);

    res.json({ message: 'Si cet email existe, un lien de réinitialisation a été envoyé.' });
  } catch (err) {
    console.error('Erreur forgot-password:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// Réinitialisation du mot de passe via token
router.post('/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
    }

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ error: 'Lien invalide ou expiré.' });
    }

    // On hash manuellement pour éviter tout effet de bord du hook pre-save
    const hash = await bcrypt.hash(password, 12);

    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          password: hash,
          passwordChangedAt: new Date(Date.now() - 1000),
        },
        $unset: {
          resetPasswordToken: '',
          resetPasswordExpires: '',
        },
      }
    );

    res.json({ message: 'Mot de passe réinitialisé avec succès.' });
  } catch (err) {
    console.error('Erreur reset-password:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

export default router;