import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  username: { 
    type: String, 
    required: true, 
    unique: true,
    trim: true,
    lowercase: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    match: [/^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/, 'Veuillez fournir une adresse email valide']
  },
  password: { 
    type: String, 
    required: true,
    select: false
  },
  previousPasswords: { 
    type: [String], 
    select: false, 
    default: [] 
  },
  passwordChangedAt: { 
    type: Date,
    select: false
  },
  role: { 
    type: String, 
    enum: ['admin', 'user'], 
    default: 'user' 
  },
  notificationPreferences: {
    email: {
      enabled: { type: Boolean, default: false },
      bookCompleted: { type: Boolean, default: true }
    },
    push: {
      enabled: { type: Boolean, default: true }
    }
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  emailVerificationToken: String,
  emailVerificationExpires: Date,
  lastLogin: {
    type: Date,
    default: null
  },
  lastActivity: {
    type: Date,
    default: null
  },
  resetPasswordToken: String,
  resetPasswordExpires: Date,
  requestLimit: {
    type: Number,
    default: 10,
    min: 0
  },
  avatar: {
    type: String,
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  },
  twoFactor: {
    enabled: { type: Boolean, default: false },
    secret: { type: String, select: false },
    recoveryCodes: {
      type: [{ code: String, used: { type: Boolean, default: false } }],
      select: false,
      default: []
    }
  }
}, {
  timestamps: true
});

// Index pour les recherches par email
userSchema.index({ email: 1 }, { unique: true, sparse: true });

// Middleware pour hacher le mot de passe avant de sauvegarder
userSchema.pre('save', async function(next) {
  // Ne pas hacher le mot de passe s'il n'a pas été modifié
  if (!this.isModified('password')) return next();

  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    if (this.isModified('password') && !this.isNew) {
      this.passwordChangedAt = Date.now() - 1000;
    }
    
    next();
  } catch (error) {
    next(error);
  }
});

// Méthode pour comparer les mots de passe
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Méthode pour vérifier si le mot de passe a été changé après l'émission du token JWT
userSchema.methods.changedPasswordAfter = function(JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(
      this.passwordChangedAt.getTime() / 1000,
      10
    );
    return JWTTimestamp < changedTimestamp;
  }
  return false;
};

export default mongoose.model('User', userSchema);