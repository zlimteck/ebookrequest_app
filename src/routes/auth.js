import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import User from '../models/User.js';
import Session from '../models/Session.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { sendPasswordResetEmail } from '../services/emailService.js';
import { getEmailContext } from '../services/emailConfig.js';
import { createSession, getClientIP } from '../utils/sessionUtils.js';
import { COOKIE_OPTIONS, clearCookieOptions } from '../utils/cookieOptions.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

// ── Setup initial ────────────────────────────────────────────────────────────

// Vérifie si un premier admin doit être créé
router.get('/setup-status', async (req, res) => {
  try {
    const adminExists = await User.findOne({ role: 'admin' });
    const { cfg: emailCfg } = await getEmailContext();
    // mcpOrigin : instance self-hosted, le domaine du serveur MCP n'est
    // jamais le même d'une installation à l'autre — dérivé de MCP_URL (déjà
    // configurable, voir .env.example) plutôt que codé en dur, pour que
    // Login.jsx puisse valider le paramètre ?continue= du flux OAuth MCP
    // sans connaître ce domaine à l'avance.
    let mcpOrigin = null;
    try {
      if (process.env.MCP_URL) mcpOrigin = new URL(process.env.MCP_URL).origin;
    } catch { /* MCP_URL mal formée : mcpOrigin reste null */ }
    res.json({
      setupRequired: !adminExists,
      fromEmail: emailCfg.fromAddress || null,
      mcpOrigin,
    });
  } catch {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// Création du premier compte admin (bloqué si un admin existe déjà)
router.post('/setup', async (req, res) => {
  try {
    const adminExists = await User.findOne({ role: 'admin' });
    if (adminExists) {
      return res.status(403).json({ error: 'Un administrateur existe déjà.' });
    }

    const { username, email, password } = req.body;

    if (!username?.trim() || !email?.trim() || !password) {
      return res.status(400).json({ error: 'Tous les champs sont obligatoires.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères.' });
    }

    const passwordStrength = [
      /[a-z]/.test(password),
      /[A-Z]/.test(password),
      /[0-9]/.test(password),
      /[!@#$%^&*(),.?":{}|<>]/.test(password),
    ].filter(Boolean).length;

    if (passwordStrength < 3) {
      return res.status(400).json({ error: 'Mot de passe trop faible. Utilisez au moins 3 des éléments suivants : minuscule, majuscule, chiffre, caractère spécial.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Adresse email invalide.' });
    }

    const admin = new User({
      username: username.trim().toLowerCase(),
      email: email.trim().toLowerCase(),
      password,
      role: 'admin',
      emailVerified: true,
    });

    await admin.save();

    // Connecter automatiquement après la création
    const sid = await createSession(admin._id, {
      ip: getClientIP(req),
      userAgent: req.headers['user-agent'] || '',
      loginMethod: 'password',
    });
    const token = jwt.sign(
      { id: admin._id, role: admin.role, sid },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.cookie('token', token, COOKIE_OPTIONS);
    res.json({
      success: true,
      role: admin.role,
      user: {
        id: admin._id,
        username: admin.username,
        email: admin.email,
        role: admin.role,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ error: 'Ce nom d\'utilisateur ou cet email est déjà utilisé.' });
    }
    res.status(500).json({ error: 'Erreur lors de la création du compte.' });
  }
});

// Vérifier la validité du token
router.get('/check-token', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }
    res.json({ user });
  } catch (error) {
    console.error('Erreur lors de la vérification du token:', error);
    res.status(500).json({ error: 'Erreur serveur lors de la vérification du token' });
  }
});

// ── Pont d'identité pour le flux OAuth MCP (feat/mcp-oauth) ────────────────
// Le serveur MCP (mcp.ebookrequest.fr, service séparé, sans accès aux
// identifiants) redirige vers /login?continue=<url /oauth-continue>
// pour authentifier l'utilisateur avec le compte EbookRequest existant.
// Une fois connecté ici (session déjà valide ou via handleLoginSuccess),
// le frontend échange cette session contre un "ticket" signé de courte durée
// (60s, usage unique via jti, consommé côté mcp/) prouvant l'identité de
// l'utilisateur sans jamais transmettre de mot de passe ni de token
// permanent (opdsToken) au serveur MCP.
const MCP_LOGIN_TICKET_SECRET = process.env.MCP_LOGIN_TICKET_SECRET;
const MCP_CONTINUE_PATH = '/oauth-continue';

router.post('/mcp-login-ticket', requireAuth, (req, res) => {
  if (!MCP_LOGIN_TICKET_SECRET || !process.env.MCP_URL) {
    return res.status(503).json({ error: 'Flux OAuth MCP non configuré sur ce serveur.' });
  }
  try {
    const { continueUrl } = req.body;
    if (!continueUrl) return res.status(400).json({ error: 'continueUrl requis.' });

    // Vérification stricte côté serveur, en plus de celle déjà faite côté
    // frontend (Login.jsx) : comparaison exacte origin + pathname contre
    // MCP_URL (configurable, jamais codé en dur — self-hosted), jamais de
    // startsWith/includes, pour ne jamais devenir une redirection ouverte.
    let parsed;
    let expectedOrigin;
    try {
      parsed = new URL(continueUrl);
      expectedOrigin = new URL(process.env.MCP_URL).origin;
    } catch {
      return res.status(400).json({ error: 'continueUrl invalide.' });
    }
    if (parsed.origin !== expectedOrigin || parsed.pathname !== MCP_CONTINUE_PATH) {
      return res.status(400).json({ error: 'continueUrl non autorisée.' });
    }

    const ticket = jwt.sign(
      { sub: req.user.id, jti: crypto.randomUUID() },
      MCP_LOGIN_TICKET_SECRET,
      { algorithm: 'HS256', expiresIn: '60s' }
    );
    res.json({ ticket });
  } catch (error) {
    console.error('Erreur lors de la génération du ticket MCP:', error.message);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// Inscription (admin seulement)
router.post('/register', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username, password, role } = req.body;
    
    // Validation des champs
    if (!username || !password) {
      return res.status(400).json({ error: 'Tous les champs sont requis' });
    }
    
    if (password.length < 8) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères' });
    }
    const passwordStrength = [/[a-z]/.test(password), /[A-Z]/.test(password), /[0-9]/.test(password), /[!@#$%^&*(),.?":{}|<>]/.test(password)].filter(Boolean).length;
    if (passwordStrength < 3) {
      return res.status(400).json({ error: 'Mot de passe trop faible. Utilisez au moins 3 des éléments suivants : minuscule, majuscule, chiffre, caractère spécial.' });
    }

    // Vérifier si l'utilisateur existe déjà
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: 'Ce nom d\'utilisateur est déjà utilisé' });
    }
    
    // Hacher le mot de passe
    const hash = await bcrypt.hash(password, 10);
    
    // Créer l'utilisateur
    const user = new User({ 
      username, 
      password: hash, 
      role: role || 'user' 
    });
    
    await user.save();
    
    // Ne pas renvoyer le mot de passe
    const userResponse = user.toObject();
    delete userResponse.password;
    
    res.status(201).json({
      success: true,
      message: 'Utilisateur créé avec succès',
      user: userResponse
    });
    
  } catch (err) {
    console.error('Erreur lors de la création de l\'utilisateur:', err);
    
    if (err.name === 'ValidationError') {
      const messages = Object.values(err.errors).map(val => val.message);
      return res.status(400).json({ error: messages.join('. ') });
    }
    
    if (err.code === 11000) {
      return res.status(400).json({ error: 'Ce nom d\'utilisateur est déjà utilisé' });
    }
    
    res.status(500).json({ error: 'Erreur lors de la création de l\'utilisateur' });
  }
});

// Connexion
router.post('/login', async (req, res) => {
  try {
    const { username: rawUsername, password } = req.body;
    const username = rawUsername?.toLowerCase().trim();

    if (!username || !password) {
      return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe requis.' });
    }

    // Récupérer l'utilisateur avec le mot de passe
    const user = await User.findOne({ username }).select('+password');

    if (!user) {
      return res.status(401).json({ error: 'Identifiants invalides.' });
    }

    // Vérifier le verrouillage avant toute autre chose
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const minutesLeft = Math.ceil((user.lockedUntil - Date.now()) / 60000);
      return res.status(423).json({
        error: `Compte temporairement verrouillé. Réessayez dans ${minutesLeft} minute${minutesLeft > 1 ? 's' : ''}.`,
      });
    }

    if (user.isActive === false) {
      return res.status(403).json({ error: 'Votre compte a été désactivé. Contactez un administrateur.' });
    }

    const valid = await bcrypt.compare(password, user.password);

    if (!valid) {
      const attempts = (user.failedLoginAttempts || 0) + 1;
      const update = { failedLoginAttempts: attempts };
      if (attempts >= 5) {
        update.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
        update.failedLoginAttempts = 0;
      }
      await User.updateOne({ _id: user._id }, { $set: update });
      return res.status(401).json({ error: 'Identifiants invalides.' });
    }

    // Mot de passe correct — reset des compteurs
    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await User.updateOne({ _id: user._id }, { $set: { failedLoginAttempts: 0, lockedUntil: null } });
    }

    // Vérifier si le 2FA est activé
    if (user.twoFactor?.enabled) {
      const tempToken = jwt.sign(
        { id: user._id, scope: '2fa' },
        JWT_SECRET,
        { expiresIn: '5m' }
      );
      return res.json({ twoFactorRequired: true, tempToken });
    }

    // Connexion réussie — mise à jour lastLogin
    await User.updateOne(
      { _id: user._id },
      { $set: { lastLogin: new Date(), lastActivity: new Date() } }
    );

    const sid = await createSession(user._id, {
      ip: getClientIP(req),
      userAgent: req.headers['user-agent'] || '',
      loginMethod: 'password',
    });
    const token = jwt.sign({
      id: user._id,
      role: user.role,
      sid,
    }, JWT_SECRET, { expiresIn: '30d' });

    res.cookie('token', token, COOKIE_OPTIONS);
    res.json({
      role: user.role,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        lastLogin: user.lastLogin,
        lastActivity: user.lastActivity
      }
    });
  } catch (err) {
    console.error('Erreur lors de la connexion:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// Demande de réinitialisation de mot de passe
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requis.' });

    const user = await User.findOne({ email: email.toLowerCase().trim() });

    // Toujours répondre OK pour ne pas révéler si l'email existe
    if (!user) {
      return res.json({ message: 'Si cet email existe, un lien de réinitialisation a été envoyé.' });
    }

    // Anti-spam : interdire une nouvelle demande si un token récent existe (< 15 min)
    const COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes
    if (user.resetPasswordExpires && user.resetPasswordExpires > new Date(Date.now() + 60 * 60 * 1000 - COOLDOWN_MS)) {
      return res.status(429).json({
        error: 'Un lien de réinitialisation a déjà été envoyé récemment. Veuillez patienter 15 minutes avant de réessayer.'
      });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    // updateOne pour éviter le hook pre-save (pas de hachage accidentel du mot de passe)
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          resetPasswordToken: tokenHash,
          resetPasswordExpires: new Date(Date.now() + 60 * 60 * 1000), // 1h
        },
      }
    );

    await sendPasswordResetEmail(user.email, user.username, token);

    res.json({ message: 'Si cet email existe, un lien de réinitialisation a été envoyé.' });
  } catch (err) {
    console.error('Erreur forgot-password:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// Réinitialisation du mot de passe via token
router.post('/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères.' });
    }
    const passwordStrength = [/[a-z]/.test(password), /[A-Z]/.test(password), /[0-9]/.test(password), /[!@#$%^&*(),.?":{}|<>]/.test(password)].filter(Boolean).length;
    if (passwordStrength < 3) {
      return res.status(400).json({ error: 'Mot de passe trop faible. Utilisez au moins 3 des éléments suivants : minuscule, majuscule, chiffre, caractère spécial.' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
      resetPasswordToken: tokenHash,
      resetPasswordExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ error: 'Lien invalide ou expiré.' });
    }

    // On hash manuellement pour éviter tout effet de bord du hook pre-save
    const hash = await bcrypt.hash(password, 12);

    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          password: hash,
          passwordChangedAt: new Date(Date.now() - 1000),
        },
        $unset: {
          resetPasswordToken: '',
          resetPasswordExpires: '',
        },
      }
    );

    // Révoquer toutes les sessions — le compte vient d'être récupéré via email
    await Session.deleteMany({ userId: user._id });

    res.json({ message: 'Mot de passe réinitialisé avec succès.' });
  } catch (err) {
    console.error('Erreur reset-password:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// Déconnexion : efface le cookie et révoque la session
router.post('/logout', async (req, res) => {
  const token = req.cookies?.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev_secret');
      if (decoded.sid) {
        await Session.deleteOne({ _id: decoded.sid });
      }
    } catch {} // toujours effacer le cookie même si le token est invalide
  }
  res.clearCookie('token', clearCookieOptions());
  res.json({ success: true });
});

export default router;