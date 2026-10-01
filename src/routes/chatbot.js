import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { isAIConfigured } from '../services/aiProviderService.js';
import { chatWithTools, getRateLimitInfo, incrementUsage } from '../services/chatbotService.js';
import { getUserAchievements } from '../services/achievementsService.js';
import { unlockFlag } from '../services/flagService.js';
import { FLAG_LABELS, SECRET_PHRASE } from '../constants/flags.js';
import User from '../models/User.js';

const router = express.Router();

// Vérifie si le chatbot est disponible pour l'utilisateur courant
router.get('/status', requireAuth, async (req, res) => {
  try {
    if (!(await isAIConfigured())) return res.json({ available: false, reason: 'no_ai' });

    const user = await User.findById(req.user.id).select('chatbotEnabled chatbotDailyLimit role').lean();
    if (!user?.chatbotEnabled && user?.role !== 'admin') return res.json({ available: false, reason: 'disabled' });

    const userLimit = user.chatbotDailyLimit ?? 10;
    const { remaining, limit } = getRateLimitInfo(String(req.user.id), userLimit);
    res.json({ available: true, remaining, limit });
  } catch {
    res.status(500).json({ available: false, reason: 'error' });
  }
});

// Envoie un message au chatbot
router.post('/message', requireAuth, async (req, res) => {
  try {
    if (!(await isAIConfigured())) return res.status(503).json({ error: 'IA non configurée.' });

    const user = await User.findById(req.user.id).select('chatbotEnabled chatbotDailyLimit role unlockedFlags').lean();
    if (!user?.chatbotEnabled && user?.role !== 'admin') return res.status(403).json({ error: 'Accès au chatbot non autorisé.' });

    const userLimit = user.chatbotDailyLimit ?? 10;
    const { allowed, remaining } = getRateLimitInfo(String(req.user.id), userLimit);
    if (!allowed) return res.status(429).json({ error: `Limite journalière atteinte (${userLimit} messages/jour). Revenez demain.` });

    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages requis.' });
    }

    // Limiter l'historique et la longueur des messages
    const history = messages.slice(-10).map(m => ({
      role:    m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, 500),
    }));

    const lastMessage = history[history.length - 1]?.content?.trim();
    if (!lastMessage) {
      return res.status(400).json({ error: 'Message vide.' });
    }

    // Flag secret caché dans le payload base64 de /api/flags/base64 (voir
    // constants/flags.js) : glisser la bonne phrase dans un message chatbot débloque
    // un second flag. Réponse custom plutôt que de laisser passer au modèle : le
    // system prompt hors-sujet (SYSTEM_PROMPT dans chatbotService.js) répondrait sinon
    // par le refus générique, aucune garantie que le modèle "joue le jeu" sinon. Ne
    // compte pas dans le quota quotidien, pas d'appel IA pour ce tour.
    // Prérequis : n'a d'effet que si le flag base64 a déjà été trouvé — quelqu'un qui
    // tomberait sur la phrase sans être passé par là (partagée, devinée) ne doit rien
    // débloquer et le message doit être traité normalement par le bot.
    if (lastMessage.toLowerCase() === SECRET_PHRASE.toLowerCase() && user.unlockedFlags?.includes('base64')) {
      unlockFlag(req.user.id, 'secretPhrase', FLAG_LABELS.secretPhrase).catch(() => {});
      return res.json({
        reply: "Bien joué, tu as déchiffré le base64 et compris où le coller. Flag débloqué : va checker ton profil.",
        remaining,
      });
    }

    incrementUsage(String(req.user.id));
    User.updateOne({ _id: req.user.id }, { $inc: { chatbotMessagesSent: 1 } })
      .then(() => getUserAchievements(req.user.id).catch(() => {}))
      .catch(() => {});
    const { remaining: updatedRemaining } = getRateLimitInfo(String(req.user.id), userLimit);

    const isAdmin = user.role === 'admin';
    const reply = await chatWithTools(history, req.user.id, isAdmin);

    res.json({ reply, remaining: updatedRemaining });
  } catch (err) {
    console.error('[Chatbot] Erreur:', err.message);
    res.status(500).json({ error: 'Erreur lors de la génération de la réponse.' });
  }
});

export default router;
