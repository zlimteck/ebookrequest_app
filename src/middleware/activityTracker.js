import User from '../models/User.js';

const updateLastActivity = async (req, res, next) => {
  if (req.user) {
    try {
      await User.findByIdAndUpdate(req.user.id, { 
        lastActivity: new Date() 
      });
    } catch (error) {
      console.error('Erreur lors de la mise à jour de l\'activité:', error);
    }
  }
  next();
};

export default updateLastActivity;