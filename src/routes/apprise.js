import express from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import appriseService from '../services/appriseService.js';

const router = express.Router();

// Statut public (accessible à tous les users connectés)
router.get('/status', requireAuth, async (req, res) => {
  try {
    const config = await appriseService.getConfig();
    res.json({ enabled: !!(config?.enabled && config?.appriseUrls?.trim()) });
  } catch {
    res.json({ enabled: false });
  }
});

// Récupérer la configuration Apprise
router.get('/config', requireAuth, async (req, res) => {
  try {
    const config = await appriseService.getConfig();
    res.json(config || {
      enabled: false, appriseUrls: '',
      notifyOnNewRequest: true, notifyOnComplete: true, notifyOnCancel: true,
      notifyOnComment: true, notifyOnReport: true, notifyOnNewUser: false,
      notifyOnDownloadFailed: true,
    });
  } catch (error) {
    console.error('Erreur récupération config Apprise:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération de la configuration' });
  }
});

// Mettre à jour la configuration Apprise
router.put('/config', requireAuth, async (req, res) => {
  try {
    const { enabled, appriseUrls, notifyOnNewRequest, notifyOnComplete, notifyOnCancel, notifyOnComment, notifyOnReport, notifyOnNewUser, notifyOnDownloadFailed } = req.body;

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
      notifyOnComplete:   notifyOnComplete   !== false,
      notifyOnCancel:     notifyOnCancel     !== false,
      notifyOnComment:    notifyOnComment    !== false,
      notifyOnReport:     notifyOnReport     !== false,
      notifyOnNewUser:        notifyOnNewUser        === true,
      notifyOnDownloadFailed: notifyOnDownloadFailed !== false,
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

// Tester les URLs Apprise personnelles de l'utilisateur connecté
router.post('/test-user', requireAuth, async (req, res) => {
  try {
    const User = mongoose.model('User');

    const globalConfig = await appriseService.getConfig();
    if (!globalConfig?.enabled) {
      return res.status(400).json({ message: 'Apprise n\'est pas activé sur cette instance' });
    }

    const user = await User.findById(req.user.id).select('notificationPreferences');
    if (!user) return res.status(404).json({ message: 'Utilisateur non trouvé' });

    const apprise = user.notificationPreferences?.apprise;
    if (!apprise?.enabled || !apprise?.urls?.trim()) {
      return res.status(400).json({ message: 'Configurez et activez vos URLs Apprise avant de tester' });
    }

    const urls = appriseService._parseUrls(apprise.urls);
    if (urls.length === 0) {
      return res.status(400).json({ message: 'Aucune URL Apprise valide configurée' });
    }

    const APPRISE_API_URL = (process.env.APPRISE_URL || 'http://apprise:8000').replace(/\/notify\/?$/, '');
    const response = await fetch(`${APPRISE_API_URL}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        urls,
        title: '🔔 Test Apprise — EbookRequest',
        body: '✅ Vos notifications personnelles Apprise fonctionnent correctement !'
      }),
      signal: AbortSignal.timeout(10000)
    });

    if (response.ok) {
      res.json({ message: 'Notification de test envoyée avec succès !' });
    } else {
      const text = await response.text();
      res.status(500).json({ message: `Erreur Apprise API: ${response.status} — ${text}` });
    }
  } catch (error) {
    console.error('Erreur test Apprise user:', error);
    res.status(500).json({ message: 'Erreur lors du test', error: error.message });
  }
});

export default router;