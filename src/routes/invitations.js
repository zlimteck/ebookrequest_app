import express from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import Invitation from '../models/Invitation.js';
import User from '../models/User.js';
import { sendInvitationEmail } from '../services/emailService.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const EXPIRES_DAYS = 7;

// ── Admin : lister les invitations ───────────────────────────────────────────
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    // Marquer comme expirées celles dont la date est passée
    await Invitation.updateMany(
      { status: 'pending', expiresAt: { $lt: new Date() } },
      { $set: { status: 'expired' } }
    );
    const invitations = await Invitation.find()
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, invitations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin : envoyer une invitation ───────────────────────────────────────────
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email requis.' });

    const normalizedEmail = email.toLowerCase().trim();

    // Vérifier si un user existe déjà avec cet email
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(409).json({ error: `Un compte existe déjà avec l'email ${normalizedEmail}.` });
    }

    // Vérifier si une invitation pending existe déjà pour cet email
    const existingInvite = await Invitation.findOne({ email: normalizedEmail, status: 'pending' });
    if (existingInvite) {
      return res.status(409).json({ error: `Une invitation est déjà en attente pour ${normalizedEmail}.` });
    }

    const admin = await User.findById(req.user.id).select('username');
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + EXPIRES_DAYS * 24 * 60 * 60 * 1000);

    const invitation = await Invitation.create({
      email: normalizedEmail,
      token,
      expiresAt,
      invitedBy: req.user.id,
      invitedByUsername: admin?.username || 'Admin',
    });

    await sendInvitationEmail(normalizedEmail, admin?.username || 'Admin', token);

    res.status(201).json({ success: true, invitation });
  } catch (err) {
    console.error('Erreur création invitation:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Admin : renvoyer une invitation ──────────────────────────────────────────
router.post('/:id/resend', requireAuth, requireAdmin, async (req, res) => {
  try {
    const invitation = await Invitation.findById(req.params.id);
    if (!invitation) return res.status(404).json({ error: 'Invitation introuvable.' });
    if (invitation.status === 'accepted') return res.status(400).json({ error: 'Cette invitation a déjà été acceptée.' });

    // Renouveler le token et l'expiration
    invitation.token = crypto.randomBytes(32).toString('hex');
    invitation.expiresAt = new Date(Date.now() + EXPIRES_DAYS * 24 * 60 * 60 * 1000);
    invitation.status = 'pending';
    await invitation.save();

    const admin = await User.findById(req.user.id).select('username');
    await sendInvitationEmail(invitation.email, admin?.username || 'Admin', invitation.token);

    res.json({ success: true, message: 'Invitation renvoyée.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Admin : annuler une invitation ───────────────────────────────────────────
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const invitation = await Invitation.findById(req.params.id);
    if (!invitation) return res.status(404).json({ error: 'Invitation introuvable.' });
    await invitation.deleteOne();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Public : valider un token d'invitation ────────────────────────────────────
router.get('/validate/:token', async (req, res) => {
  try {
    const invitation = await Invitation.findOne({ token: req.params.token, status: 'pending' });
    if (!invitation || invitation.expiresAt < new Date()) {
      return res.status(400).json({ valid: false, error: 'Invitation invalide ou expirée.' });
    }
    res.json({ valid: true, email: invitation.email });
  } catch (err) {
    res.status(500).json({ valid: false, error: err.message });
  }
});

// ── Public : s'inscrire via invitation ───────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { token, username, password } = req.body;
    if (!token || !username || !password) {
      return res.status(400).json({ error: 'Token, nom d\'utilisateur et mot de passe requis.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères.' });
    }

    const invitation = await Invitation.findOne({ token, status: 'pending' });
    if (!invitation || invitation.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Invitation invalide ou expirée.' });
    }

    // Vérifier username unique
    const existingUser = await User.findOne({ username: username.toLowerCase().trim() });
    if (existingUser) {
      return res.status(409).json({ error: 'Ce nom d\'utilisateur est déjà utilisé.' });
    }

    const hash = await bcrypt.hash(password, 12);
    const user = await User.create({
      username: username.toLowerCase().trim(),
      password: hash,
      email: invitation.email,
      emailVerified: true, // Email validé via l'invitation
      role: 'user',
    });

    // Marquer l'invitation comme acceptée
    invitation.status = 'accepted';
    invitation.acceptedAt = new Date();
    await invitation.save();

    const jwtToken = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });

    res.status(201).json({
      success: true,
      token: jwtToken,
      role: user.role,
      user: { id: user._id, username: user.username, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error('Erreur register invitation:', err);
    if (err.code === 11000) return res.status(409).json({ error: 'Ce nom d\'utilisateur est déjà utilisé.' });
    res.status(500).json({ error: err.message });
  }
});

export default router;