import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { generate, verify, generateURI } from 'otplib';
import QRCode from 'qrcode';
import User from '../models/User.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

// Génère un secret TOTP en base32 via crypto natif Node.js (évite @noble/hashes)
// 20 bytes → encodage base32 propre → 32 caractères (standard RFC 4648)
const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const generateTOTPSecret = () => {
  const bytes = crypto.randomBytes(20); // 160 bits
  let bits = 0, value = 0, result = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += BASE32_CHARS[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) result += BASE32_CHARS[(value << (5 - bits)) & 31];
  return result; // 32 caractères
};

// Wrappers async vers l'API fonctionnelle otplib v12+
const totpGenerate = (secret) => generate({ secret, type: 'totp' });
const totpVerify = (token, secret) => verify({ token, secret, type: 'totp' });
const totpURI = (label, issuer, secret) => generateURI({ type: 'totp', label, issuer, secret });

// GET /setup — génère le secret et le QR code (authentifié, 2FA pas encore activé)
router.get('/setup', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    const alreadyEnabled = user.twoFactor?.enabled || false;

    // Générer un nouveau secret (via crypto natif Node.js)
    const secret = generateTOTPSecret();

    // Stocker le secret temporairement (enabled reste false)
    await User.updateOne({ _id: user._id }, { $set: { 'twoFactor.secret': secret } });

    // Générer le QR code
    const otpauth = await totpURI(user.username, 'EbookRequest', secret);
    const qrDataUrl = await QRCode.toDataURL(otpauth);

    res.json({ secret, qrDataUrl, alreadyEnabled });
  } catch (err) {
    console.error('Erreur 2FA setup:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /verify-setup — confirme le premier code TOTP et active le 2FA
router.post('/verify-setup', requireAuth, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Code requis' });

    const user = await User.findById(req.user.id).select('+twoFactor.secret +twoFactor.recoveryCodes');
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    if (!user.twoFactor?.secret) {
      return res.status(400).json({ error: 'Aucun secret trouvé. Lancez d\'abord /setup.' });
    }

    const result = await totpVerify(code, user.twoFactor.secret);
    const valid = result?.valid ?? result === true;
    if (!valid) return res.status(400).json({ error: 'Code invalide' });

    // Générer 8 codes de récupération (format XXXXX-XXXXX)
    const plainCodes = Array.from({ length: 8 }, () => {
      const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
      return raw.slice(0, 5) + '-' + raw.slice(5);
    });

    // Hacher chaque code avec bcrypt
    const hashedCodes = await Promise.all(
      plainCodes.map(async (c) => ({ code: await bcrypt.hash(c, 10), used: false }))
    );

    await User.updateOne({ _id: user._id }, {
      $set: {
        'twoFactor.enabled': true,
        'twoFactor.recoveryCodes': hashedCodes
      }
    });

    res.json({ success: true, recoveryCodes: plainCodes });
  } catch (err) {
    console.error('Erreur 2FA verify-setup:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /disable — désactive le 2FA (nécessite le mot de passe ou un code TOTP)
router.post('/disable', requireAuth, async (req, res) => {
  try {
    const { password, code } = req.body;

    if (!password && !code) {
      return res.status(400).json({ error: 'Mot de passe ou code TOTP requis' });
    }

    const user = await User.findById(req.user.id).select('+password +twoFactor.secret');
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    if (password) {
      const validPwd = await bcrypt.compare(password, user.password);
      if (!validPwd) return res.status(401).json({ error: 'Mot de passe incorrect' });
    } else if (code) {
      if (!user.twoFactor?.secret) {
        return res.status(400).json({ error: '2FA non configuré' });
      }
      const result = await totpVerify(code, user.twoFactor.secret);
      const validCode = result?.valid ?? result === true;
      if (!validCode) return res.status(401).json({ error: 'Code invalide' });
    }

    await User.updateOne({ _id: user._id }, {
      $set: { 'twoFactor.enabled': false },
      $unset: { 'twoFactor.secret': '', 'twoFactor.recoveryCodes': '' }
    });

    res.json({ success: true, message: '2FA désactivé' });
  } catch (err) {
    console.error('Erreur 2FA disable:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /verify-login — valide le code TOTP lors de la connexion (utilise tempToken)
router.post('/verify-login', async (req, res) => {
  try {
    const { tempToken, code } = req.body;
    if (!tempToken || !code) {
      return res.status(400).json({ error: 'Token temporaire et code requis' });
    }

    let decoded;
    try {
      decoded = jwt.verify(tempToken, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Token temporaire invalide ou expiré' });
    }

    if (decoded.scope !== '2fa') {
      return res.status(401).json({ error: 'Token invalide' });
    }

    const user = await User.findById(decoded.id).select('+twoFactor.secret');
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    if (!user.twoFactor?.secret) {
      return res.status(400).json({ error: '2FA non configuré' });
    }

    const result = await totpVerify(code, user.twoFactor.secret);
    const valid = result?.valid ?? result === true;
    if (!valid) return res.status(401).json({ error: 'Code invalide' });

    // Émettre le JWT complet
    const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });

    await User.updateOne({ _id: user._id }, {
      $set: { lastLogin: new Date(), lastActivity: new Date() }
    });

    res.json({
      token,
      role: user.role,
      user: { id: user._id, username: user.username, email: user.email, role: user.role }
    });
  } catch (err) {
    console.error('Erreur 2FA verify-login:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /recover — utilise un code de récupération (utilise tempToken)
router.post('/recover', async (req, res) => {
  try {
    const { tempToken, recoveryCode } = req.body;
    if (!tempToken || !recoveryCode) {
      return res.status(400).json({ error: 'Token temporaire et code de récupération requis' });
    }

    let decoded;
    try {
      decoded = jwt.verify(tempToken, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Token temporaire invalide ou expiré' });
    }

    if (decoded.scope !== '2fa') {
      return res.status(401).json({ error: 'Token invalide' });
    }

    const user = await User.findById(decoded.id).select('+twoFactor.recoveryCodes +twoFactor.secret');
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    const codes = user.twoFactor?.recoveryCodes || [];
    let matchIndex = -1;

    for (let i = 0; i < codes.length; i++) {
      const entry = codes[i];
      if (!entry.used && await bcrypt.compare(recoveryCode.trim().toUpperCase(), entry.code)) {
        matchIndex = i;
        break;
      }
    }

    if (matchIndex === -1) {
      return res.status(401).json({ error: 'Code de récupération invalide' });
    }

    // Marquer le code comme utilisé
    await User.updateOne(
      { _id: user._id, [`twoFactor.recoveryCodes.${matchIndex}.used`]: false },
      { $set: { [`twoFactor.recoveryCodes.${matchIndex}.used`]: true } }
    );

    // Émettre le JWT complet
    const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });

    await User.updateOne({ _id: user._id }, {
      $set: { lastLogin: new Date(), lastActivity: new Date() }
    });

    res.json({
      token,
      role: user.role,
      user: { id: user._id, username: user.username, email: user.email, role: user.role }
    });
  } catch (err) {
    console.error('Erreur 2FA recover:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;