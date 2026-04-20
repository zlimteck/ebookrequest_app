import mongoose from 'mongoose';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { sendVerificationEmail, sendPasswordChangedEmail } from '../services/emailService.js';

const User = mongoose.model('User');

// Met à jour le profil utilisateur (email et préférences de notification)
export const updateUserProfile = async (req, res) => {
  try {
    const { email, notificationPreferences } = req.body;
    const updates = {};
    
    // Récupérer l'utilisateur complet pour avoir accès au nom d'utilisateur
    const currentUser = await User.findById(req.user.id);
    if (!currentUser) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
    
    // Vérifier si l'email est fourni
    if (email) {
      // Si l'email est différent de l'actuel
      if (email !== currentUser.email) {
        // Vérifier si l'email est déjà utilisé (même non vérifié)
        const existingUser = await User.findOne({ 
          email: email.toLowerCase(),
          _id: { $ne: req.user.id } // Exclure l'utilisateur actuel
        });
        
        if (existingUser) {
          return res.status(400).json({ 
            error: 'Cette adresse email est déjà utilisée par un autre compte.',
            field: 'email'
          });
        }
        
        // Générer un token de vérification
        const verificationToken = crypto.randomBytes(20).toString('hex');
        const verificationExpires = new Date();
        verificationExpires.setHours(verificationExpires.getHours() + 24); // 24h pour vérifier
        
        updates.email = email;
        updates.emailVerified = false;
        updates.emailVerificationToken = verificationToken;
        updates.emailVerificationExpires = verificationExpires;
        
        try {
          // Envoyer l'email de vérification avec le nom d'utilisateur
          await sendVerificationEmail(email, verificationToken, currentUser.username);
        } catch (emailError) {
          console.error('Erreur SMTP:', emailError);
        }
      } else if (currentUser.emailVerified) {
        updates.emailVerified = true;
        updates.emailVerificationToken = undefined;
        updates.emailVerificationExpires = undefined;
      }
    }
    
    // Mettre à jour les préférences de notification si fournies
    if (notificationPreferences) {
      updates.notificationPreferences = {
        ...req.user.notificationPreferences,
        ...notificationPreferences
      };
    }
    
    // Mettre à jour l'utilisateur
    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { $set: updates },
      { new: true, runValidators: true }
    ).select('-password -emailVerificationToken -resetPasswordToken -__v');
    
    res.json({ success: true, user: updatedUser });
  } catch (error) {
    console.error('Erreur lors de la mise à jour du profil:', error);
    
    // Message d'erreur plus détaillé en développement
    const errorMessage = process.env.NODE_ENV === 'development' 
      ? `Erreur lors de la mise à jour du profil: ${error.message}`
      : 'Erreur lors de la mise à jour du profil';
    
    res.status(500).json({ 
      error: errorMessage,
      ...(process.env.NODE_ENV === 'development' && { details: error.stack })
    });
  }
};

// Vérifie l'email de l'utilisateur avec le token fourni
export const verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;
    const user = await User.findOne({
      emailVerificationToken: token,
      emailVerificationExpires: { $gt: Date.now() }
    });
    
    if (!user) {
      return res.status(400).json({ 
        success: false,
        error: 'Lien de vérification invalide ou expiré.' 
      });
    }
    
    user.emailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();
    if (req.user) {
      return res.json({ 
        success: true, 
        message: 'Email vérifié avec succès !',
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          role: user.role,
          emailVerified: true
        }
      });
    }
    
    res.json({ 
      success: true, 
      message: 'Email vérifié avec succès ! Veuillez vous connecter.'
    });
    
  } catch (error) {
    console.error('Erreur lors de la vérification de l\'email:', error);
    res.status(500).json({ 
      success: false,
      error: 'Une erreur est survenue lors de la vérification de l\'email' 
    });
  }
};

// Récupère le profil de l'utilisateur connecté
export const getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('username email role emailVerified notificationPreferences avatar createdAt updatedAt');

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    res.json({
      success: true,
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerified,
        notificationPreferences: user.notificationPreferences,
        avatar: user.avatar || null,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });
  } catch (error) {
    console.error('Erreur lors de la récupération du profil utilisateur:', error);
    res.status(500).json({ error: 'Erreur lors de la récupération du profil utilisateur' });
  }
};

// Met à jour l'avatar de l'utilisateur (base64)
export const updateAvatar = async (req, res) => {
  try {
    const { avatar } = req.body;

    // Vérifier la taille : base64 d'une image ~1.5MB = ~2MB de texte
    if (avatar && avatar.length > 2 * 1024 * 1024) {
      return res.status(400).json({ error: 'L\'image est trop grande (max ~1.5 MB)' });
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: { avatar: avatar || null } },
      { new: true }
    ).select('avatar');

    res.json({ success: true, avatar: user.avatar });
  } catch (error) {
    console.error('Erreur lors de la mise à jour de l\'avatar:', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour de l\'avatar' });
  }
};

// Stats du profil de l'utilisateur connecté
export const getUserStats = async (req, res) => {
  try {
    const BookRequest = mongoose.model('BookRequest');
    const [user, total, pending, completed, canceled, reported, downloaded] = await Promise.all([
      User.findById(req.user.id).select('username avatar role createdAt'),
      BookRequest.countDocuments({ user: req.user.id }),
      BookRequest.countDocuments({ user: req.user.id, status: 'pending' }),
      BookRequest.countDocuments({ user: req.user.id, status: 'completed' }),
      BookRequest.countDocuments({ user: req.user.id, status: 'canceled' }),
      BookRequest.countDocuments({ user: req.user.id, status: 'reported' }),
      BookRequest.countDocuments({ user: req.user.id, downloadedAt: { $ne: null } }),
    ]);
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    res.json({ success: true, stats: { total, pending, completed, canceled, reported, downloaded, completionRate }, user });
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la récupération des statistiques' });
  }
};

// Change le mot de passe de l'utilisateur
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    // Validation des entrées
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ 
        error: 'Veuillez fournir l\'ancien et le nouveau mot de passe',
        field: !currentPassword ? 'currentPassword' : 'newPassword'
      });
    }
    
    // Récupérer l'utilisateur avec le mot de passe hashé
    const user = await User.findById(req.user.id).select('+password +previousPasswords');
    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
    
    // Vérifier l'ancien mot de passe
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ 
        error: 'Le mot de passe actuel est incorrect',
        field: 'currentPassword'
      });
    }
    
    // Vérifier si le nouveau mot de passe est identique à l'ancien
    if (currentPassword === newPassword) {
      return res.status(400).json({
        error: 'Le nouveau mot de passe doit être différent de l\'ancien',
        field: 'newPassword'
      });
    }
    
    // Vérifier si le mot de passe a déjà été utilisé
    const isUsedBefore = await Promise.all(
      user.previousPasswords.map(async oldHash => {
        return await bcrypt.compare(newPassword, oldHash);
      })
    ).then(results => results.some(result => result === true));
    
    if (isUsedBefore) {
      return res.status(400).json({
        error: 'Ce mot de passe a déjà été utilisé. Veuillez en choisir un autre.',
        field: 'newPassword'
      });
    }
    
    // Vérifier la force du mot de passe
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>])[A-Za-z\d!@#$%^&*(),.?":{}|<>]{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({
        error: 'Le mot de passe doit contenir au moins 8 caractères, dont des majuscules, des chiffres et des caractères spéciaux',
        field: 'newPassword'
      });
    }
    
    // Ajouter les 5 derniers mot de passe à l'historique
    user.previousPasswords = [user.password, ...user.previousPasswords].slice(0, 5);
    
    // Mettre à jour le mot de passe
    user.password = newPassword;
    user.passwordChangedAt = Date.now();
    
    await user.save();
    
    // Essayer d'envoyer une notification par email (optionnel) si l'email est valide
    if (user.email && 
        typeof user.email === 'string' && 
        user.email.includes('@') &&
        process.env.SMTP_HOST && 
        process.env.SMTP_USER && 
        process.env.SMTP_PASSWORD) {
      try {
        await sendPasswordChangedEmail(user.email, user.username);
      } catch (emailError) {
        const isSmtpError = [
          'ECONNECTION', 'EAUTH', 'EENVELOPE', 'EMESSAGE'
        ].includes(emailError.code);
        
        if (!isSmtpError) {
          console.error('Erreur lors de l\'envoi de l\'email de notification:', emailError.message);
        }
      }
    }
    
    res.json({ 
      success: true, 
      message: 'Mot de passe mis à jour avec succès' 
    });
    
  } catch (error) {
    console.error('Erreur lors du changement de mot de passe:', error);
    res.status(500).json({ 
      error: 'Une erreur est survenue lors du changement de mot de passe' 
    });
  }
};