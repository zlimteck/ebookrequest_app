import mongoose from 'mongoose';

const bestsellerSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  author: {
    type: String,
    required: true,
    trim: true
  },
  category: {
    type: String,
    required: true,
    enum: ['all', 'thriller', 'romance', 'sf', 'bd', 'fantasy', 'literary']
  },
  order: {
    type: Number,
    default: 0
  },
  active: {
    type: Boolean,
    default: true
  },
  addedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Index pour optimiser les requêtes
bestsellerSchema.index({ category: 1, order: 1, active: 1 });

// Middleware pour mettre à jour updatedAt
bestsellerSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

const Bestseller = mongoose.model('Bestseller', bestsellerSchema);

export default Bestseller;