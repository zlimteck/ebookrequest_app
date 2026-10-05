import express from 'express';
import crypto from 'crypto';
import EmailLog from '../models/EmailLog.js';
import ConnectorSettings from '../models/ConnectorSettings.js';
import { decrypt } from '../services/cryptoService.js';

const router = express.Router();

// Résout le secret de signature SVIX : priorité à la config DB (admin ->
// Réglages -> Resend), repli sur la variable d'env pour compat ascendante.
async function getResendWebhookSecret() {
  try {
    const doc = await ConnectorSettings.findOne({ service: 'emailProvider' }).lean();
    if (doc?.resendWebhookSecret) {
      return decrypt(doc.resendWebhookSecret) ?? doc.resendWebhookSecret;
    }
  } catch {
    // MongoDB indisponible → repli sur l'env
  }
  return process.env.RESEND_WEBHOOK_SECRET || '';
}

// Resend signe ses webhooks avec SVIX
// https://resend.com/docs/dashboard/webhooks/introduction
async function verifyResendSignature(req) {
  const secret = await getResendWebhookSecret();
  if (!secret) return false; // Fail closed — rejeter si secret non configuré

  const svixId        = req.headers['svix-id'];
  const svixTimestamp = req.headers['svix-timestamp'];
  const svixSignature = req.headers['svix-signature'];

  if (!svixId || !svixTimestamp || !svixSignature) return false;

  // Vérification anti-replay : timestamp < 5 min
  const ts = parseInt(svixTimestamp, 10);
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const body = req.rawBody || JSON.stringify(req.body);
  const toSign = `${svixId}.${svixTimestamp}.${body}`;

  // Le secret Resend est prefixé "whsec_" + base64
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const hmac = crypto.createHmac('sha256', secretBytes).update(toSign).digest('base64');

  // svix-signature peut contenir plusieurs signatures (v1,XXXX v1,YYYY)
  const signatures = svixSignature.split(' ').map(s => s.replace(/^v1,/, ''));
  return signatures.some(sig => {
    try {
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(hmac));
    } catch { return false; }
  });
}

// Mapper les types d'événements Resend vers nos statuts
const EVENT_MAP = {
  'email.sent':        'sent',
  'email.delivered':   'delivered',
  'email.opened':      'opened',
  'email.clicked':     'clicked',
  'email.bounced':     'bounced',
  'email.complained':  'complained',
};

// POST /api/webhooks/resend
// Pas d'auth JWT — authentifié via signature SVIX
router.post('/resend', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    // Reconstruire le body depuis le buffer brut
    const rawBody = req.body instanceof Buffer ? req.body.toString() : JSON.stringify(req.body);
    req.rawBody = rawBody;

    if (!(await verifyResendSignature(req))) {
      return res.status(401).json({ error: 'Signature invalide' });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return res.status(400).json({ error: 'JSON invalide' });
    }

    const { type, data } = payload;
    const emailId = data?.email_id;

    if (!emailId) {
      return res.status(200).json({ received: true }); // Ignorer les events sans ID
    }

    const eventType = EVENT_MAP[type];
    if (!eventType) {
      return res.status(200).json({ received: true }); // Événement inconnu → ignorer
    }

    // Données supplémentaires selon le type
    let extraData = {};
    if (type === 'email.clicked' && data?.click?.link) {
      extraData.link = data.click.link;
    }
    if (type === 'email.bounced') {
      extraData.reason = data?.bounce?.message || data?.reason;
    }

    await EmailLog.findOneAndUpdate(
      { emailId },
      {
        $set: { status: eventType },
        $push: {
          events: {
            type: eventType,
            timestamp: new Date(data?.created_at || Date.now()),
            data: Object.keys(extraData).length ? extraData : undefined,
          },
        },
      }
    );

    res.status(200).json({ received: true });
  } catch (err) {
    console.error('[webhook/resend]', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

export default router;