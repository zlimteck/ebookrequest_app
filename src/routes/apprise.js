import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import appriseService from '../services/appriseService.js';

const router = express.Router();

// Récupérer la configuration Apprise
router.get('/config', requireAuth, async (req, res) => {
  try {
    const config = await appriseService.getConfig();
    res.json(config || { enabled: false, appriseUrls: '', notifyOnNewRequest: true });
  } catch (error) {
    console.error('Erreur récupération config Apprise:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération de la configuration' });
  }
});

// Mettre à jour la configuration Apprise
router.put('/config', requireAuth, async (req, res) => {
  try {
    const { enabled, appriseUrls, notifyOnNewRequest } = req.body;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ message: 'Le champ "enabled" est requis (boolean)' });
    }
    if (enabled && (!appriseUrls || !appriseUrls.trim())) {
      return res.status(400).json({ message: 'Au moins une URL Apprise est requise pour activer les notifications' });
    }

    const config = await appriseService.updateConfig({
      enabled,
      appriseUrls: appriseUrls || '',
      notifyOnNewRequest: notifyOnNewRequest !== false,
      configuredBy: req.user.id
    });

    res.json(config);
  } catch (error) {
    console.error('Erreur mise à jour config Apprise:', error);
    res.status(500).json({ message: 'Erreur lors de la mise à jour de la configuration' });
  }
});

// Tester la configuration Apprise
router.post('/test', requireAuth, async (req, res) => {
  try {
    const config = await appriseService.getConfig();

    if (!config || !config.enabled || !config.appriseUrls?.trim()) {
      return res.status(400).json({ message: 'Veuillez configurer et activer Apprise avant de tester' });
    }

    const result = await appriseService.sendNotification(
      '🔔 Test Apprise — EbookRequest',
      '✅ Votre configuration Apprise fonctionne correctement !\n\nVous recevrez des notifications pour les nouvelles demandes de livres.'
    );

    if (result.success) {
      res.json({ message: 'Notification de test envoyée avec succès !' });
    } else {
      res.status(500).json({ message: result.message || 'Échec de l\'envoi de la notification de test' });
    }
  } catch (error) {
    console.error('Erreur test Apprise:', error);
    res.status(500).json({ message: 'Erreur lors du test', error: error.message });
  }
});

export default router;