import mongoose from 'mongoose';
import JSZip from 'jszip';
import { createRequire } from 'module';

import BookRequest from '../models/BookRequest.js';
import User from '../models/User.js';
import ConnectorSettings from '../models/ConnectorSettings.js';
import ReadingList from '../models/ReadingList.js';
import DownloadLog from '../models/DownloadLog.js';
import Notification from '../models/Notification.js';
import AdminLog from '../models/AdminLog.js';
import EmailLog from '../models/EmailLog.js';
import OpdsLog from '../models/OpdsLog.js';
import AIRequestLog from '../models/AIRequestLog.js';
import Bestseller from '../models/Bestseller.js';
import Recommendation from '../models/Recommendation.js';
import Invitation from '../models/Invitation.js';
import InvitationCode from '../models/InvitationCode.js';
import DeviceToken from '../models/DeviceToken.js';
import PushSubscription from '../models/PushSubscription.js';
import AppriseConfig from '../models/AppriseConfig.js';
import PushoverConfig from '../models/PushoverConfig.js';

const require = createRequire(import.meta.url);
const { version: APP_VERSION } = require('../../package.json');

// Session/TrendingCache volontairement absents : éphémère (JWT) ou pur cache
// auto-régénéré, aucune valeur à restaurer (voir issue #43).
//
// `strip` retire les secrets de connecteurs tiers du dump (mots de passe,
// clés API, cookies de session, URLs Apprise qui embarquent des tokens...).
// Les identifiants du compte lui-même (User.password, twoFactor, opdsToken,
// readingShare.token) sont volontairement GARDÉS : ce ne sont pas des
// secrets de service tiers, ce sont les comptes utilisateurs eux-mêmes —
// les exclure casserait la connexion de tout le monde après une restauration.
const BACKUP_MODELS = [
  { name: 'bookrequests', model: BookRequest },
  {
    name: 'users',
    model: User,
    // select:false sur password ET twoFactor.secret/recoveryCodes côté schéma
    // (vérifié en conditions réelles : un premier export sans ce `select`
    // explicite produisait des users SANS hash de mot de passe du tout —
    // une restauration aurait bloqué tout le monde hors de son compte).
    // calibreWeb.password / valentine.password / hardcover.apiKey gardés tels
    // quels : chiffrés via cryptoService (AES-256-CBC, clé dérivée de
    // JWT_SECRET, jamais stockée en DB ni dans ce dump) — mêmes garanties que
    // le hash bcrypt du mot de passe, pas de secret en clair exposé.
    select: '+password +twoFactor.secret +twoFactor.recoveryCodes',
  },
  // ConnectorSettings : apiKey/password/resendWebhookSecret/apnsRelayToken
  // gardés tels quels, chiffrés via cryptoService comme ci-dessus — permet en
  // plus à une restauration sur la même instance (même JWT_SECRET) de
  // retrouver des connecteurs directement fonctionnels, sans ressaisie.
  { name: 'connectorsettings', model: ConnectorSettings },
  { name: 'readinglists', model: ReadingList },
  { name: 'downloadlogs', model: DownloadLog },
  { name: 'notifications', model: Notification },
  { name: 'adminlogs', model: AdminLog },
  { name: 'emaillogs', model: EmailLog },
  { name: 'opdslogs', model: OpdsLog },
  { name: 'airequestlogs', model: AIRequestLog },
  { name: 'bestsellers', model: Bestseller },
  { name: 'recommendations', model: Recommendation },
  { name: 'invitations', model: Invitation },
  { name: 'invitationcodes', model: InvitationCode },
  { name: 'devicetokens', model: DeviceToken },
  { name: 'pushsubscriptions', model: PushSubscription },
  {
    name: 'appriseconfigs',
    model: AppriseConfig,
    // appriseUrls embarque directement les tokens des services notifiés
    // (ex: pover://userKey@apiToken, discord://webhookId/token...).
    strip: (doc) => {
      doc.appriseUrls = '';
      return doc;
    },
  },
  {
    name: 'pushoverconfigs',
    model: PushoverConfig,
    strip: (doc) => {
      doc.userKey = '';
      doc.apiToken = '';
      return doc;
    },
  },
];

export async function exportBackup() {
  const zip = new JSZip();

  const collections = [];
  for (const { name, model, select, strip } of BACKUP_MODELS) {
    const query = model.find();
    if (select) query.select(select);
    const docs = await query.lean();
    const cleaned = strip ? docs.map(strip) : docs;
    zip.file(`${name}.json`, JSON.stringify(cleaned, null, 2));
    collections.push({ name, count: cleaned.length });
  }

  zip.file('meta.json', JSON.stringify({
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    collections,
  }, null, 2));

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/**
 * Restauration en remplacement complet (purge puis réimport), pas de fusion —
 * décision actée dans l'issue #43. Toutes les collections sont remplacées
 * dans une seule transaction Mongo pour rester cohérentes entre elles (ex.
 * ReadingList.requestId pointant vers un BookRequest) : soit tout passe, soit
 * rien n'est modifié en cas d'erreur sur une collection.
 */
export async function restoreBackup(zipBuffer) {
  const zip = await JSZip.loadAsync(zipBuffer);

  const metaFile = zip.file('meta.json');
  if (!metaFile) {
    throw new Error('Archive invalide : meta.json manquant.');
  }
  const meta = JSON.parse(await metaFile.async('string'));

  const toRestore = [];
  for (const { name, model } of BACKUP_MODELS) {
    const file = zip.file(`${name}.json`);
    if (!file) continue; // collection absente de ce dump (export plus ancien, champ ajouté depuis) — ignorée, pas bloquante
    const docs = JSON.parse(await file.async('string'));
    toRestore.push({ name, model, docs });
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const { model, docs } of toRestore) {
        await model.deleteMany({}, { session });
        if (docs.length) {
          await model.insertMany(docs, { session, ordered: false });
        }
      }
    });
  } finally {
    await session.endSession();
  }

  return {
    appVersion: meta.appVersion,
    exportedAt: meta.exportedAt,
    versionMismatch: meta.appVersion !== APP_VERSION,
    restored: toRestore.map(({ name, docs }) => ({ name, count: docs.length })),
  };
}
