import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import User from '../models/User.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { sendVerificationEmail } from '../services/emailService.js';

const router = express.Router();

// Créer un nouvel utilisateur (admin seulement)
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username, email, password, role } = req.body;
    
    // Validation des données
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Tous les champs sont obligatoires' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });
    }
    
    // Vérifier si l'utilisateur existe déjà
    const existingUser = await User.findOne({ 
      $or: [
        { username },
        { email: email.toLowerCase() }
      ]
    });
    
    if (existingUser) {
      return res.status(400).json({ 
        error: 'Un utilisateur avec ce nom d\'utilisateur ou cette adresse email existe déjà' 
      });
    }
    
    // Créer un token de vérification d'email
    const verificationToken = crypto.randomBytes(20).toString('hex');
    const verificationExpires = new Date();
    verificationExpires.setHours(verificationExpires.getHours() + 24); // 24h pour vérifier
    
    // Créer le nouvel utilisateur
    const newUser = new User({
      username,
      email: email.toLowerCase(),
      password,
      role: role || 'user',
      emailVerificationToken: verificationToken,
      emailVerificationExpires: verificationExpires
    });
    
    await newUser.save();
    
    // Envoyer l'email de vérification
    try {
      await sendVerificationEmail(email, verificationToken, username);
    } catch (emailError) {
      console.error('Erreur lors de l\'envoi de l\'email de vérification:', emailError);
      // On continue quand même la création
    }
    
    // Ne pas renvoyer le mot de passe
    const userResponse = newUser.toObject();
    delete userResponse.password;
    delete userResponse.emailVerificationToken;
    
    res.status(201).json({
      success: true,
      message: 'Utilisateur créé avec succès. Un email de vérification a été envoyé.',
      user: userResponse
    });
    
  } catch (error) {
    console.error('Erreur lors de la création de l\'utilisateur:', error);
    
    // Gestion des erreurs de validation Mongoose
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({ error: messages.join('. ') });
    }
    
    // Erreur de duplication (code 11000)
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({ 
        error: `Ce ${field === 'username' ? 'nom d\'utilisateur' : 'email'} est déjà utilisé.` 
      });
    }
    
    res.status(500).json({ 
      error: 'Une erreur est survenue lors de la création de l\'utilisateur' 
    });
  }
});

// Récupérer tous les utilisateurs (admin seulement)
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const users = await User.find(
      {},
      'username email role emailVerified createdAt updatedAt lastLogin lastActivity requestLimit avatar isActive'
    ).sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    console.error('Erreur lors de la récupération des utilisateurs:', error);
    res.status(500).json({ error: 'Erreur serveur lors de la récupération des utilisateurs' });
  }
});

// Mettre à jour un utilisateur (admin seulement)
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { username, email, role, password, requestLimit } = req.body;
    
    // Vérifier si l'utilisateur existe
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
    
    // Mettre à jour les champs
    const updates = {};
    
    if (username && username !== user.username) {
      // Vérifier si le nouveau nom d'utilisateur est déjà utilisé
      const existingUser = await User.findOne({ username });
      if (existingUser) {
        return res.status(400).json({ error: 'Ce nom d\'utilisateur est déjà utilisé' });
      }
      updates.username = username;
    }
    
    if (email && email !== user.email) {
      // Vérifier si le nouvel email est déjà utilisé
      const existingEmail = await User.findOne({ email: email.toLowerCase() });
      if (existingEmail) {
        return res.status(400).json({ error: 'Cette adresse email est déjà utilisée' });
      }
      
      const verificationToken = crypto.randomBytes(20).toString('hex');
      const verificationExpires = new Date();
      verificationExpires.setHours(verificationExpires.getHours() + 24); // 24h pour vérifier
      
      updates.email = email.toLowerCase();
      updates.emailVerified = false;
      updates.emailVerificationToken = verificationToken;
      updates.emailVerificationExpires = verificationExpires;
      
      // Envoyer l'email de vérification
      try {
        await sendVerificationEmail(email, verificationToken, user.username);
      } catch (emailError) {
        console.error('Erreur lors de l\'envoi de l\'email de vérification:', emailError);
        // On continue quand même la mise à jour
      }
    }
    
    if (role && ['admin', 'user'].includes(role)) {
      updates.role = role;
    }

    if (requestLimit !== undefined) {
      const parsed = parseInt(requestLimit, 10);
      if (isNaN(parsed) || parsed < 0) {
        return res.status(400).json({ error: 'La limite de demandes doit être un entier positif ou nul.' });
      }
      updates.requestLimit = parsed;
    }
    
    if (password && password.length >= 6) {
      const hash = await bcrypt.hash(password, 10);
      updates.password = hash;
    } else if (password) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });
    }
    
    // Mettre à jour l'utilisateur
    const updatedUser = await User.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    ).select('-password -emailVerificationToken -resetPasswordToken -__v');
    
    res.json({ 
      success: true, 
      message: 'Utilisateur mis à jour avec succès' + (updates.email ? '. Un email de vérification a été envoyé.' : ''),
      user: updatedUser
    });
    
  } catch (error) {
    console.error('Erreur lors de la mise à jour de l\'utilisateur:', error);
    
    // Gestion des erreurs de validation Mongoose
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(val => val.message);
      return res.status(400).json({ error: messages.join('. ') });
    }
    
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({ 
        error: `Ce ${field === 'username' ? 'nom d\'utilisateur' : 'email'} est déjà utilisé.` 
      });
    }
    
    res.status(500).json({ 
      error: 'Une erreur est survenue lors de la mise à jour de l\'utilisateur' 
    });
  }
});

// Activer / désactiver un utilisateur (admin seulement)
router.patch('/:id/toggle-active', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (id === req.user.id) {
      return res.status(400).json({ error: 'Vous ne pouvez pas désactiver votre propre compte' });
    }
    const user = await User.findById(id).select('isActive');
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    const newActive = user.isActive !== false; // false uniquement si explicitement false
    // findByIdAndUpdate contourne le pre-save hook (pas de risque sur le mot de passe)
    await User.findByIdAndUpdate(id, { $set: { isActive: !newActive } });

    res.json({
      isActive: !newActive,
      message: !newActive ? 'Compte activé' : 'Compte désactivé',
    });
  } catch (error) {
    console.error('Erreur toggle-active:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour du statut' });
  }
});

// Supprimer un utilisateur (admin seulement)
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    if (id === req.user.id) {
      return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte' });
    }
    
    const user = await User.findByIdAndDelete(id);
    
    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
    
    res.json({ message: 'Utilisateur supprimé avec succès' });
  } catch (error) {
    console.error('Erreur lors de la suppression de l\'utilisateur:', error);
    res.status(500).json({ error: 'Erreur serveur lors de la suppression de l\'utilisateur' });
  }
});

export default router;