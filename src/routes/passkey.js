import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { requireAuth } from '../middleware/auth.js';
import User from '../models/User.js';
import { COOKIE_OPTIONS } from '../utils/cookieOptions.js';

// Validates a base64url string (credential ID format)
const CRED_ID_MAX_LEN = 512;
const CHALLENGE_ID_RE = /^[0-9a-f]{32}$/;
function isValidCredentialID(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= CRED_ID_MAX_LEN && /^[A-Za-z0-9_-]+$/.test(id);
}

const router = express.Router();

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const rpID = new URL(FRONTEND_URL).hostname;
const origin = FRONTEND_URL;
const rpName = 'EbookRequest';
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';

// ── Challenge store (in-memory, TTL 5 min) ───────────────────────────────────
const challengeStore = new Map();

function storeChallenge(key, challenge) {
  challengeStore.set(key, { challenge, expires: Date.now() + 5 * 60 * 1000 });
}

function getChallenge(key) {
  const entry = challengeStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    challengeStore.delete(key);
    return null;
  }
  challengeStore.delete(key); // one-time use
  return entry.challenge;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of challengeStore) {
    if (now > v.expires) challengeStore.delete(k);
  }
}, 60_000);

// ── Registration ──────────────────────────────────────────────────────────────

// [M1] POST (pas GET) — effets de bord : stockage du challenge
router.post('/register-options', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('username passkeys').lean();
    if (!user) return res.status(404).json({ error: 'Utilisateur non trouvé.' });

    const excludeCredentials = (user.passkeys || []).map(pk => ({
      id: pk.credentialID,
      transports: pk.transports,
    }));

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: new TextEncoder().encode(user._id.toString()),
      userName: user.username,
      userDisplayName: user.username,
      attestation: 'none',
      excludeCredentials,
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
    });

    storeChallenge(`reg:${req.user.id}`, options.challenge);
    res.json(options);
  } catch (err) {
    console.error('Passkey register-options:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.post('/register-verify', requireAuth, async (req, res) => {
  try {
    const { response, name } = req.body;
    if (!response) return res.status(400).json({ error: 'Réponse manquante.' });

    const challenge = getChallenge(`reg:${req.user.id}`);
    if (!challenge) return res.status(400).json({ error: 'Challenge expiré, réessayez.' });

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: 'Vérification échouée.' });
    }

    const { credential, aaguid } = verification.registrationInfo;

    // Check for duplicate credential ID (prevent re-registration)
    const existing = await User.findOne({ 'passkeys.credentialID': credential.id });
    if (existing) return res.status(400).json({ error: 'Cette passkey est déjà enregistrée.' });

    const passkey = {
      credentialID: credential.id,
      credentialPublicKey: Buffer.from(credential.publicKey).toString('base64'),
      counter: credential.counter,
      transports: credential.transports || [],
      aaguid: aaguid || '',
      name: (name?.trim() || 'Passkey').slice(0, 50),
      createdAt: new Date(),
    };

    await User.findByIdAndUpdate(req.user.id, { $push: { passkeys: passkey } });

    res.json({
      success: true,
      passkey: { credentialID: passkey.credentialID, name: passkey.name, createdAt: passkey.createdAt },
    });
  } catch (err) {
    console.error('Passkey register-verify:', err);
    res.status(500).json({ error: 'Erreur lors de l\'enregistrement de la passkey.' });
  }
});

// ── Authentication ────────────────────────────────────────────────────────────

router.post('/authenticate-options', async (req, res) => {
  try {
    const challengeId = crypto.randomBytes(16).toString('hex');

    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'required',
      allowCredentials: [], // discoverable credentials
    });

    storeChallenge(`auth:${challengeId}`, options.challenge);
    res.json({ ...options, challengeId });
  } catch (err) {
    console.error('Passkey authenticate-options:', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.post('/authenticate-verify', async (req, res) => {
  try {
    const { response, challengeId } = req.body;
    if (!response || !challengeId) return res.status(400).json({ error: 'Paramètres manquants.' });

    // [L2] Valider le format du challengeId (hex 32 chars)
    if (!CHALLENGE_ID_RE.test(challengeId)) {
      return res.status(400).json({ error: 'challengeId invalide.' });
    }

    const challenge = getChallenge(`auth:${challengeId}`);
    if (!challenge) return res.status(400).json({ error: 'Challenge expiré, réessayez.' });

    // Decode userHandle to get userId
    const userHandle = response?.response?.userHandle;
    if (!userHandle) return res.status(401).json({ error: 'Authentification échouée.' });

    // [M2] Valider userId comme ObjectId MongoDB avant toute requête DB
    let userId;
    try {
      const decoded = Buffer.from(userHandle, 'base64').toString('utf8');
      if (!mongoose.Types.ObjectId.isValid(decoded)) {
        return res.status(401).json({ error: 'Authentification échouée.' });
      }
      userId = decoded;
    } catch {
      return res.status(401).json({ error: 'Authentification échouée.' });
    }

    // [L1] Valider le format du credentialID
    const credentialID = response.id;
    if (!isValidCredentialID(credentialID)) {
      return res.status(401).json({ error: 'Authentification échouée.' });
    }

    const user = await User.findById(userId).select('username role isActive passkeys twoFactor').lean();
    if (!user || user.isActive === false) {
      return res.status(401).json({ error: 'Authentification échouée.' });
    }

    const passkey = (user.passkeys || []).find(pk => pk.credentialID === credentialID);
    if (!passkey) return res.status(401).json({ error: 'Authentification échouée.' });

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: passkey.credentialID,
        publicKey: new Uint8Array(Buffer.from(passkey.credentialPublicKey, 'base64')),
        counter: passkey.counter,
        transports: passkey.transports,
      },
      requireUserVerification: true,
    });

    if (!verification.verified) {
      return res.status(401).json({ error: 'Authentification échouée.' });
    }

    // Update counter + login timestamps
    await User.updateOne(
      { _id: userId, 'passkeys.credentialID': credentialID },
      {
        $set: {
          'passkeys.$.counter': verification.authenticationInfo.newCounter,
          lastLogin: new Date(),
          lastActivity: new Date(),
        },
      }
    );

    // Une passkey avec userVerification=required est MFA par définition (possession + biométrie/PIN).
    // Le TOTP n'est pas redemandé — cohérent avec Apple, Google, Microsoft.
    const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
    res.cookie('token', token, COOKIE_OPTIONS);
    res.json({
      role: user.role,
      user: { id: user._id, username: user.username, role: user.role },
    });
  } catch (err) {
    console.error('Passkey authenticate-verify:', err);
    res.status(500).json({ error: 'Erreur lors de l\'authentification.' });
  }
});

// ── Management ────────────────────────────────────────────────────────────────

router.get('/list', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('passkeys').lean();
    const list = (user?.passkeys || []).map(pk => ({
      credentialID: pk.credentialID,
      name: pk.name,
      createdAt: pk.createdAt,
      transports: pk.transports,
    }));
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.patch('/:credentialID/rename', requireAuth, async (req, res) => {
  try {
    // [L1] Valider le format du credentialID
    if (!isValidCredentialID(req.params.credentialID)) {
      return res.status(400).json({ error: 'credentialID invalide.' });
    }
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Nom requis.' });

    const result = await User.updateOne(
      { _id: req.user.id, 'passkeys.credentialID': req.params.credentialID },
      { $set: { 'passkeys.$.name': name.trim().slice(0, 50) } }
    );

    if (result.matchedCount === 0) return res.status(404).json({ error: 'Passkey non trouvée.' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.delete('/:credentialID', requireAuth, async (req, res) => {
  try {
    // [L1] Valider le format du credentialID
    if (!isValidCredentialID(req.params.credentialID)) {
      return res.status(400).json({ error: 'credentialID invalide.' });
    }
    await User.updateOne(
      { _id: req.user.id },
      { $pull: { passkeys: { credentialID: req.params.credentialID } } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

export default router;
