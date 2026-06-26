import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { isAIConfigured } from '../services/aiProviderService.js';
import { chatWithTools, getRateLimitInfo, incrementUsage } from '../services/chatbotService.js';
import User from '../models/User.js';

const router = express.Router();

// Vérifie si le chatbot est disponible pour l'utilisateur courant
router.get('/status', requireAuth, async (req, res) => {
  try {
    if (!isAIConfigured()) return res.json({ available: false, reason: 'no_ai' });

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
    if (!isAIConfigured()) return res.status(503).json({ error: 'IA non configurée.' });

    const user = await User.findById(req.user.id).select('chatbotEnabled chatbotDailyLimit role').lean();
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

    if (!history[history.length - 1]?.content?.trim()) {
      return res.status(400).json({ error: 'Message vide.' });
    }

    incrementUsage(String(req.user.id));
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
