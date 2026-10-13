import mongoose from 'mongoose';
import JSZip from 'jszip';
import crypto from 'crypto';
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

// Distingue une erreur "faute de l'utilisateur" (mauvais mot de passe, zip
// invalide/trop gros) d'une vraie panne serveur — permet à la route de
// répondre 400 dans le premier cas, 500 dans le second, sans dépendre d'un
// matching fragile sur le texte du message.
export class BackupValidationError extends Error {}

// Garde-fou contre un zip-bomb côté restauration (audit sécurité) : l'upload
// est déjà plafonné à 50 Mo côté multer (src/routes/admin.js), mais rien ne
// limitait la taille UNE FOIS DÉCOMPRESSÉE — un fichier très compressé pouvait
// gonfler à plusieurs Go en mémoire avant même d'arriver à JSON.parse. On lit
// la taille décompressée déclarée par le zip (métadonnée du format, avant de
// décompresser quoi que ce soit) et on refuse si elle dépasse ces limites.
const MAX_ENTRY_UNCOMPRESSED_BYTES = 500 * 1024 * 1024; // 500 Mo par fichier JSON
const MAX_TOTAL_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024; // 1 Go pour l'archive entière

function getDeclaredUncompressedSize(zipObject) {
  // API interne non documentée de JSZip, mais fiable en pratique (lue depuis
  // le zip central directory, donc disponible avant toute décompression).
  return zipObject?._data?.uncompressedSize ?? null;
}

// Chiffrement optionnel du zip avec un mot de passe saisi par l'admin au
// moment de l'export — jamais stocké, distinct de JWT_SECRET (qui protège
// déjà les secrets des connecteurs individuellement, voir plus bas). Format :
// magic bytes + sel (scrypt) + IV + authTag + ciphertext, le tout préfixé
// pour distinguer un zip chiffré d'un zip normal dès les premiers octets
// (restoreBackup doit savoir lequel il reçoit sans supposer).
const ENCRYPTED_MAGIC = Buffer.from('EBKR1\0');
const SCRYPT_SALT_BYTES = 16;
const GCM_IV_BYTES = 12;

function deriveKey(password, salt) {
  return crypto.scryptSync(password, salt, 32);
}

function encryptZipBuffer(zipBuffer, password) {
  const salt = crypto.randomBytes(SCRYPT_SALT_BYTES);
  const iv = crypto.randomBytes(GCM_IV_BYTES);
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(zipBuffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([ENCRYPTED_MAGIC, salt, iv, authTag, ciphertext]);
}

function isEncryptedBackup(buffer) {
  return buffer.length > ENCRYPTED_MAGIC.length && buffer.subarray(0, ENCRYPTED_MAGIC.length).equals(ENCRYPTED_MAGIC);
}

function decryptZipBuffer(buffer, password) {
  if (!password) {
    throw new BackupValidationError('Cette sauvegarde est protégée par un mot de passe.');
  }
  let offset = ENCRYPTED_MAGIC.length;
  const salt = buffer.subarray(offset, offset += SCRYPT_SALT_BYTES);
  const iv = buffer.subarray(offset, offset += GCM_IV_BYTES);
  const authTag = buffer.subarray(offset, offset += 16);
  const ciphertext = buffer.subarray(offset);

  const key = deriveKey(password, salt);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // GCM rejette explicitement un mauvais tag d'authentification — message
    // générique pour ne pas distinguer "mauvais mot de passe" d'un fichier
    // corrompu (pas d'oracle utile à un attaquant essayant plusieurs mots de passe).
    throw new BackupValidationError('Mot de passe incorrect ou archive corrompue.');
  }
}

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

/**
 * @param {string} [password] - Si fourni, le zip généré est chiffré
 * (AES-256-GCM, clé dérivée par scrypt). Le mot de passe n'est jamais stocké
 * nulle part, à retenir par l'admin pour une restauration future.
 */
export async function exportBackup(password) {
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

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return password ? encryptZipBuffer(zipBuffer, password) : zipBuffer;
}

/**
 * Restauration en remplacement complet (purge puis réimport), pas de fusion —
 * décision actée dans l'issue #43. Toutes les collections sont remplacées
 * dans une seule transaction Mongo pour rester cohérentes entre elles (ex.
 * ReadingList.requestId pointant vers un BookRequest) : soit tout passe, soit
 * rien n'est modifié en cas d'erreur sur une collection.
 */
export async function restoreBackup(fileBuffer, password) {
  const zipBuffer = isEncryptedBackup(fileBuffer) ? decryptZipBuffer(fileBuffer, password) : fileBuffer;
  const zip = await JSZip.loadAsync(zipBuffer);

  const metaFile = zip.file('meta.json');
  if (!metaFile) {
    throw new BackupValidationError('Archive invalide : meta.json manquant.');
  }

  // Vérifie la taille décompressée déclarée de CHAQUE entrée avant de décompresser
  // quoi que ce soit — un fichier individuel trop gros ou un total trop gros sont
  // rejetés immédiatement (voir MAX_ENTRY_UNCOMPRESSED_BYTES ci-dessus).
  let totalDeclaredSize = 0;
  for (const name of Object.keys(zip.files)) {
    const entry = zip.files[name];
    if (entry.dir) continue;
    const declaredSize = getDeclaredUncompressedSize(entry);
    if (declaredSize !== null) {
      if (declaredSize > MAX_ENTRY_UNCOMPRESSED_BYTES) {
        throw new BackupValidationError(`Archive invalide : "${name}" dépasse la taille maximale autorisée une fois décompressé.`);
      }
      totalDeclaredSize += declaredSize;
    }
  }
  if (totalDeclaredSize > MAX_TOTAL_UNCOMPRESSED_BYTES) {
    throw new BackupValidationError('Archive invalide : taille totale décompressée trop importante.');
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
