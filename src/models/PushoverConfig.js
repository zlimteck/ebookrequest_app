import mongoose from 'mongoose';

const pushoverConfigSchema = new mongoose.Schema({
  enabled: {
    type: Boolean,
    default: false
  },
  userKey: {
    type: String,
    default: ''
  },
  apiToken: {
    type: String,
    default: ''
  },
  // Pour stocker les préférences de notification
  notifyOnNewRequest: {
    type: Boolean,
    default: true
  },
  // Pour stocker l'utilisateur qui a configuré les notifications
  configuredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

// Ajouter un index unique pour s'assurer qu'il n'y a qu'une seule configuration
pushoverConfigSchema.index({}, { unique: true });

// Créer un modèle unique pour la configuration
export default mongoose.models.PushoverConfig || 
  mongoose.model('PushoverConfig', pushoverConfigSchema);
