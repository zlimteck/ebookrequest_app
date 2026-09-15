import express from 'express';
import PushSubscription from '../models/PushSubscription.js';
import { requireAuth } from '../middleware/auth.js';
import DeviceToken from '../models/DeviceToken.js';
import { isApnsConfigured } from '../services/apnsService.js';

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

// Indique si le serveur est configuré pour envoyer du push natif (APNs) — l'app iOS
// s'en sert pour éviter de demander l'autorisation de notifications si ça ne sert à rien.
router.get('/apns-status', requireAuth, async (req, res) => {
  res.json({ enabled: await isApnsConfigured() });
});

// Enregistre le jeton d'appareil APNs de l'app iOS (équivalent natif de /subscribe).
router.post('/apns/register', requireAuth, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Jeton invalide' });
    }

    // Upsert par token (pas par couple user+token) : si l'appareil avait été enregistré
    // par un autre compte (déconnexion/reconnexion sous un autre utilisateur), on veut que
    // ce token repointe vers le nouvel utilisateur plutôt que de créer un doublon.
    await DeviceToken.findOneAndUpdate(
      { token },
      { user: req.user.id, token },
      { upsert: true, new: true }
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Erreur enregistrement device token:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Supprime le jeton d'appareil APNs (déconnexion, désactivation du toggle push).
router.post('/apns/unregister', requireAuth, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Jeton requis' });
    await DeviceToken.deleteOne({ user: req.user.id, token });
    res.json({ success: true });
  } catch (err) {
    console.error('Erreur désenregistrement device token:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;
