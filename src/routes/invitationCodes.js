import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import InvitationCode from '../models/InvitationCode.js';
import User from '../models/User.js';
import { sendVerificationEmail, sendNewUserToAdminsEmail } from '../services/emailService.js';
import ConnectorSettings from '../models/ConnectorSettings.js';
import appriseService from '../services/appriseService.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

// Génère un code lisible ex: A3F7-KX92
function generateCode() {
  const part = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${part()}-${part()}`;
}

// ── Admin : lister les codes ──────────────────────────────────────────────────
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const codes = await InvitationCode.find().sort({ createdAt: -1 }).lean();
    res.json({ success: true, codes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin : créer un code ─────────────────────────────────────────────────────
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { maxUses = 1, expiresAt = null } = req.body;

    const admin = await User.findById(req.user.id).select('username');

    // Générer un code unique
    let code;
    let attempts = 0;
    do {
      code = generateCode();
      attempts++;
      if (attempts > 10) return res.status(500).json({ error: 'Impossible de générer un code unique.' });
    } while (await InvitationCode.exists({ code }));

    const invCode = await InvitationCode.create({
      code,
      maxUses: parseInt(maxUses, 10) || 1,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      createdBy: req.user.id,
      createdByUsername: admin?.username || 'Admin',
    });

    res.status(201).json({ success: true, invitationCode: invCode });
  } catch (err) {
    console.error('Erreur création code invitation:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Admin : activer / désactiver un code ──────────────────────────────────────
router.patch('/:id/toggle', requireAuth, requireAdmin, async (req, res) => {
  try {
    const invCode = await InvitationCode.findById(req.params.id);
    if (!invCode) return res.status(404).json({ error: 'Code introuvable.' });
    invCode.isActive = !invCode.isActive;
    await invCode.save();
    res.json({ success: true, isActive: invCode.isActive });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin : supprimer un code ─────────────────────────────────────────────────
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const invCode = await InvitationCode.findById(req.params.id);
    if (!invCode) return res.status(404).json({ error: 'Code introuvable.' });
    await invCode.deleteOne();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Public : valider un code ──────────────────────────────────────────────────
router.get('/validate/:code', async (req, res) => {
  try {
    const invCode = await InvitationCode.findOne({
      code: req.params.code.toUpperCase().trim(),
      isActive: true,
    });

    if (!invCode) return res.json({ valid: false, error: 'Code invalide ou désactivé.' });
    if (invCode.expiresAt && invCode.expiresAt < new Date()) {
      return res.json({ valid: false, error: 'Ce code a expiré.' });
    }
    if (invCode.maxUses > 0 && invCode.usedCount >= invCode.maxUses) {
      return res.json({ valid: false, error: 'Ce code a atteint son nombre maximum d\'utilisations.' });
    }

    res.json({ valid: true });
  } catch (err) {
    res.status(500).json({ valid: false, error: err.message });
  }
});

// ── Public : s'inscrire via code ──────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, code } = req.body;

    if (!username || !email || !password || !code) {
      return res.status(400).json({ error: 'Tous les champs sont requis.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères.' });
    }
    const passwordStrength = [/[a-z]/.test(password), /[A-Z]/.test(password), /[0-9]/.test(password), /[!@#$%^&*(),.?":{}|<>]/.test(password)].filter(Boolean).length;
    if (passwordStrength < 3) {
      return res.status(400).json({ error: 'Mot de passe trop faible. Utilisez au moins 3 des éléments suivants : minuscule, majuscule, chiffre, caractère spécial.' });
    }

    const normalizedEmail    = email.toLowerCase().trim();
    const normalizedUsername = username.toLowerCase().trim();

    // Valider le code
    const invCode = await InvitationCode.findOne({
      code: code.toUpperCase().trim(),
      isActive: true,
    });

    if (!invCode) return res.status(400).json({ error: 'Code d\'invitation invalide ou désactivé.' });
    if (invCode.expiresAt && invCode.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Ce code a expiré.' });
    }
    if (invCode.maxUses > 0 && invCode.usedCount >= invCode.maxUses) {
      return res.status(400).json({ error: 'Ce code a atteint son nombre maximum d\'utilisations.' });
    }

    // Vérifier unicité username / email
    const existingUsername = await User.findOne({ username: normalizedUsername });
    if (existingUsername) return res.status(409).json({ error: 'Ce nom d\'utilisateur est déjà utilisé.' });

    const existingEmail = await User.findOne({ email: normalizedEmail });
    if (existingEmail) return res.status(409).json({ error: 'Cette adresse email est déjà utilisée.' });

    // Créer le user (le hook pre('save') de Mongoose hash le mot de passe)
    const verificationToken  = crypto.randomBytes(32).toString('hex');
    const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

    const user = await User.create({
      username: normalizedUsername,
      email: normalizedEmail,
      password,
      emailVerified: false,
      emailVerificationToken: verificationToken,
      emailVerificationExpires: verificationExpires,
      role: 'user',
    });

    // Envoyer l'email de vérification
    try {
      await sendVerificationEmail(normalizedEmail, verificationToken, normalizedUsername);
    } catch (emailErr) {
      console.error('[InvitationCode] Erreur envoi email vérification:', emailErr.message);
    }

    // Mettre à jour le code
    invCode.usedCount += 1;
    invCode.usedBy.push({ userId: user._id, username: user.username, email: normalizedEmail, usedAt: new Date() });
    await invCode.save();

    console.log(`[InvitationCode] ${user.username} inscrit via le code ${invCode.code}`);
    appriseService.notifyNewUser(user.username, normalizedEmail).catch(() => {});
    // Email aux admins — nouvel utilisateur
    ConnectorSettings.findOne({ service: 'email' }).lean().then(async doc => {
      const enabled = doc?.emailEnabled ?? true;
      const notify  = doc?.notifyOnNewUser ?? true;
      if (!enabled || !notify) return;
      const admins = await User.find({ role: 'admin' }).select('email username emailVerified');
      admins.filter(a => a.emailVerified && a.email).forEach(admin =>
        sendNewUserToAdminsEmail(admin, user.username, normalizedEmail).catch(() => {}));
    }).catch(() => {});

    const jwtToken = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });

    res.status(201).json({
      success: true,
      message: 'Compte créé ! Un email de vérification a été envoyé.',
      token: jwtToken,
      role: user.role,
      user: { id: user._id, username: user.username, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error('Erreur register code invitation:', err);
    if (err.code === 11000) return res.status(409).json({ error: 'Ce nom d\'utilisateur ou email est déjà utilisé.' });
    res.status(500).json({ error: err.message });
  }
});

export default router;