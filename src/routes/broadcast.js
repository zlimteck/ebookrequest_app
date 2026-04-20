import express from 'express';
import User from '../models/User.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { sendBroadcastEmail } from '../services/emailService.js';
import { sendPushToUser } from '../services/webPushService.js';

const router = express.Router();

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { channels, subject, htmlContent, pushTitle, pushBody } = req.body;

    if (!channels || (!channels.email && !channels.push)) {
      return res.status(400).json({ error: 'Sélectionnez au moins un canal' });
    }
    if (channels.email && (!subject?.trim() || !htmlContent?.trim())) {
      return res.status(400).json({ error: 'Objet et contenu HTML requis pour l\'email' });
    }
    if (channels.push && !pushTitle?.trim()) {
      return res.status(400).json({ error: 'Titre requis pour la notification push' });
    }

    // Récupérer tous les users actifs
    const users = await User.find({ isActive: { $ne: false } });

    let emailSent = 0, pushSent = 0, errors = 0;

    await Promise.all(users.map(async (user) => {
      // Email — uniquement si l'user a un email
      if (channels.email && user.email) {
        try {
          await sendBroadcastEmail(user.email, subject.trim(), htmlContent);
          emailSent++;
        } catch (err) {
          console.error(`Broadcast email erreur pour ${user.email}:`, err.message);
          errors++;
        }
      }

      // Push
      if (channels.push) {
        try {
          await sendPushToUser(user._id, {
            title: pushTitle.trim(),
            body: pushBody?.trim() || '',
            url: '/',
          });
          pushSent++;
        } catch (err) {
          console.error(`Broadcast push erreur pour ${user._id}:`, err.message);
          errors++;
        }
      }
    }));

    console.log(`Broadcast envoyé — emails: ${emailSent}, push: ${pushSent}, erreurs: ${errors}`);

    res.json({
      success: true,
      emailSent: channels.email ? emailSent : undefined,
      pushSent: channels.push ? pushSent : undefined,
      errors,
      total: users.length,
    });
  } catch (error) {
    console.error('Erreur broadcast:', error);
    res.status(500).json({ error: 'Erreur lors de l\'envoi du broadcast' });
  }
});

export default router;