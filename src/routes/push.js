import express from 'express';
import PushSubscription from '../models/PushSubscription.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Retourne la clé VAPID publique
router.get('/vapid-key', (req, res) => {
  if (!process.env.VAPID_PUBLIC_KEY) {
    return res.status(503).json({ error: 'Push notifications non configurées' });
  }
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// Enregistre une souscription push
router.post('/subscribe', requireAuth, async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({ error: 'Souscription invalide' });
    }

    // Upsert : évite les doublons sur le même endpoint
    await PushSubscription.findOneAndUpdate(
      { 'subscription.endpoint': subscription.endpoint },
      { user: req.user.id, subscription },
      { upsert: true, new: true }
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Erreur souscription push:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Supprime une souscription push
router.post('/unsubscribe', requireAuth, async (req, res) => {
  try {
    const { endpoint } = req.body;
    await PushSubscription.deleteOne({
      user: req.user.id,
      'subscription.endpoint': endpoint
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Erreur désouscription push:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Vérifie si l'utilisateur a une souscription active
router.get('/status', requireAuth, async (req, res) => {
  try {
    const count = await PushSubscription.countDocuments({ user: req.user.id });
    res.json({ subscribed: count > 0 });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
