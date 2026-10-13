import crypto from 'crypto';
import { createClient } from 'webdav';
import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import ConnectorSettings from '../models/ConnectorSettings.js';
import { encrypt, decrypt } from './cryptoService.js';

// Même préfixe de nom que backupCron.js — sert à distinguer nos sauvegardes
// auto d'autres fichiers qui pourraient partager le même dossier/bucket
// distant, pour ne jamais supprimer autre chose que ce qu'on a nous-mêmes écrit.
const BACKUP_FILENAME_PREFIX = 'ebookrequest-backup-auto-';

// Un fichier de sauvegarde auto, chiffré (.zip.enc) ou non (.zip).
function isBackupFilename(basename) {
  return basename.startsWith(BACKUP_FILENAME_PREFIX) && (basename.endsWith('.zip') || basename.endsWith('.zip.enc'));
}

// Normalise le préfixe S3 (sous-dossier du bucket) : pas de slash au début,
// un seul slash à la fin si non vide. Vide par défaut = comportement
// inchangé (upload à la racine du bucket).
function normalizeS3Prefix(prefix) {
  if (!prefix) return '';
  return `${prefix.replace(/^\/+/, '').replace(/\/+$/, '')}/`;
}

/**
 * Migre une config à destination unique (anciens champs remoteBackupType/...)
 * vers le tableau remoteBackupDestinations, une seule fois, à la volée —
 * pour ne pas perdre une config déjà enregistrée avant ce changement (issue
 * #43 suite). N'écrit en DB que si une migration a effectivement eu lieu.
 */
async function getBackupDoc() {
  const doc = await ConnectorSettings.findOne({ service: 'backup' });
  if (!doc) return null;

  if ((!doc.remoteBackupDestinations || doc.remoteBackupDestinations.length === 0) && doc.remoteBackupType) {
    const migrated = {
      id: crypto.randomUUID(),
      type: doc.remoteBackupType,
      label: doc.remoteBackupType === 's3' ? 'S3 (migré)' : 'WebDAV (migré)',
      enabled: true,
      webdavUrl: doc.remoteBackupWebdavUrl || '',
      webdavUsername: doc.remoteBackupWebdavUsername || '',
      webdavPassword: doc.password || '', // déjà chiffré
      s3Endpoint: doc.remoteBackupS3Endpoint || '',
      s3Bucket: doc.remoteBackupS3Bucket || '',
      s3Region: doc.remoteBackupS3Region || 'auto',
      s3AccessKeyId: doc.remoteBackupS3AccessKeyId || '',
      s3Prefix: doc.remoteBackupS3Prefix || '',
      s3SecretAccessKey: doc.apiKey || '', // déjà chiffré
    };
    doc.remoteBackupDestinations = [migrated];
    doc.remoteBackupType = '';
    await doc.save();
    console.log('[BackupCron] Config de destination distante migrée vers le format multi-destinations.');
  }

  return doc;
}

export async function getDestinations() {
  const doc = await getBackupDoc();
  return doc?.remoteBackupDestinations || [];
}

function maskDestination(dest) {
  return {
    id: dest.id,
    type: dest.type,
    label: dest.label || '',
    enabled: !!dest.enabled,
    webdavUrl: dest.webdavUrl || '',
    webdavUsername: dest.webdavUsername || '',
    _hasWebdavPassword: !!dest.webdavPassword,
    s3Endpoint: dest.s3Endpoint || '',
    s3Bucket: dest.s3Bucket || '',
    s3Region: dest.s3Region || 'auto',
    s3AccessKeyId: dest.s3AccessKeyId || '',
    s3Prefix: dest.s3Prefix || '',
    _hasS3SecretAccessKey: !!dest.s3SecretAccessKey,
  };
}

export async function listDestinationsMasked() {
  const destinations = await getDestinations();
  return destinations.map(maskDestination);
}

/**
 * Construit l'objet destination à stocker en DB à partir du payload reçu du
 * formulaire admin — chiffre les secrets fournis en clair, garde l'ancien
 * secret chiffré si le champ est laissé vide/masqué (`_has...` à true).
 */
function buildDestinationRecord(payload, existing = null) {
  const record = {
    id: existing?.id || crypto.randomUUID(),
    type: payload.type === 's3' ? 's3' : 'webdav',
    label: payload.label?.trim() || '',
    enabled: !!payload.enabled,
    webdavUrl: payload.webdavUrl?.trim() || '',
    webdavUsername: payload.webdavUsername?.trim() || '',
    s3Endpoint: payload.s3Endpoint?.trim() || '',
    s3Bucket: payload.s3Bucket?.trim() || '',
    s3Region: payload.s3Region?.trim() || 'auto',
    s3AccessKeyId: payload.s3AccessKeyId?.trim() || '',
    s3Prefix: payload.s3Prefix?.trim() || '',
  };

  if (payload.webdavPassword && payload.webdavPassword !== '••••••••') {
    record.webdavPassword = encrypt(payload.webdavPassword);
  } else if (payload._hasWebdavPassword && existing) {
    record.webdavPassword = existing.webdavPassword;
  } else {
    record.webdavPassword = '';
  }

  if (payload.s3SecretAccessKey && payload.s3SecretAccessKey !== '••••••••') {
    record.s3SecretAccessKey = encrypt(payload.s3SecretAccessKey);
  } else if (payload._hasS3SecretAccessKey && existing) {
    record.s3SecretAccessKey = existing.s3SecretAccessKey;
  } else {
    record.s3SecretAccessKey = '';
  }

  return record;
}

export async function createDestination(payload) {
  const doc = await getBackupDoc() || new ConnectorSettings({ service: 'backup' });
  const record = buildDestinationRecord(payload);
  doc.remoteBackupDestinations = [...(doc.remoteBackupDestinations || []), record];
  await doc.save();
  return maskDestination(record);
}

export async function updateDestination(id, payload) {
  const doc = await getBackupDoc();
  if (!doc) throw new Error('Configuration introuvable.');
  const destinations = doc.remoteBackupDestinations || [];
  const index = destinations.findIndex(d => d.id === id);
  if (index === -1) throw new Error('Destination introuvable.');

  const record = buildDestinationRecord(payload, destinations[index]);
  destinations[index] = record;
  doc.remoteBackupDestinations = destinations;
  await doc.save();
  return maskDestination(record);
}

export async function deleteDestination(id) {
  const doc = await getBackupDoc();
  if (!doc) return;
  doc.remoteBackupDestinations = (doc.remoteBackupDestinations || []).filter(d => d.id !== id);
  await doc.save();
}

function buildWebdavClient(dest) {
  const password = dest.webdavPasswordPlain ?? decrypt(dest.webdavPassword) ?? '';
  return createClient(dest.webdavUrl, { username: dest.webdavUsername || '', password });
}

function buildS3Client(dest) {
  const secretAccessKey = dest.s3SecretAccessKeyPlain ?? decrypt(dest.s3SecretAccessKey) ?? '';
  return new S3Client({
    endpoint: dest.s3Endpoint,
    region: dest.s3Region || 'auto',
    credentials: { accessKeyId: dest.s3AccessKeyId || '', secretAccessKey },
    // Requis par la plupart des fournisseurs S3-compatibles hors AWS (Hetzner
    // Object Storage, Backblaze B2, MinIO, SeaweedFS...) — sans ça le SDK
    // génère des URLs virtual-hosted-style (bucket.endpoint) que ces
    // fournisseurs ne servent pas.
    forcePathStyle: true,
  });
}

async function uploadToWebdav(buffer, filename, dest) {
  if (!dest.webdavUrl) throw new Error('URL WebDAV non configurée.');
  const client = buildWebdavClient(dest);
  await client.putFileContents(filename, buffer, { overwrite: true });
}

async function uploadToS3(buffer, filename, dest) {
  if (!dest.s3Endpoint || !dest.s3Bucket) {
    throw new Error('Endpoint ou bucket S3 non configuré.');
  }
  const client = buildS3Client(dest);
  const key = `${normalizeS3Prefix(dest.s3Prefix)}${filename}`;
  await client.send(new PutObjectCommand({ Bucket: dest.s3Bucket, Key: key, Body: buffer }));
  return key;
}

/**
 * Rétention côté distant, même logique que le local (backupCron.js) : ne
 * garde que les N sauvegardes auto les plus récentes sur cette destination.
 * Ne touche jamais un fichier qui ne porte pas notre préfixe de nom — au cas
 * où le dossier/bucket distant est aussi utilisé pour autre chose.
 */
async function applyWebdavRetention(dest, retentionCount) {
  const client = buildWebdavClient(dest);
  const contents = await client.getDirectoryContents('/');
  const backups = contents
    .filter(f => f.type === 'file' && isBackupFilename(f.basename))
    .sort((a, b) => new Date(b.lastmod) - new Date(a.lastmod));
  for (const old of backups.slice(retentionCount)) {
    await client.deleteFile(old.filename);
  }
}

async function applyS3Retention(dest, retentionCount) {
  const client = buildS3Client(dest);
  const prefix = normalizeS3Prefix(dest.s3Prefix);
  const response = await client.send(new ListObjectsV2Command({ Bucket: dest.s3Bucket, Prefix: prefix }));
  const backups = (response.Contents || [])
    .filter(o => isBackupFilename(o.Key.slice(prefix.length)))
    .sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified));
  for (const old of backups.slice(retentionCount)) {
    await client.send(new DeleteObjectCommand({ Bucket: dest.s3Bucket, Key: old.Key }));
  }
}

/**
 * Copie une sauvegarde déjà écrite en local vers toutes les destinations
 * distantes actives — ne remplace jamais la copie locale, s'ajoute à elle.
 * Une destination en échec n'empêche pas les autres d'être tentées. Applique
 * ensuite la même rétention que le local sur chaque destination où l'upload
 * a réussi (un échec de rétention ne fait pas échouer l'upload lui-même).
 */
export async function uploadRemoteBackup(buffer, filename, retentionCount = 7) {
  const destinations = (await getDestinations()).filter(d => d.enabled);
  if (!destinations.length) return { results: [] };

  const results = [];
  for (const dest of destinations) {
    try {
      if (dest.type === 'webdav') {
        await uploadToWebdav(buffer, filename, dest);
      } else if (dest.type === 's3') {
        await uploadToS3(buffer, filename, dest);
      }
      try {
        if (dest.type === 'webdav') await applyWebdavRetention(dest, retentionCount);
        else if (dest.type === 's3') await applyS3Retention(dest, retentionCount);
      } catch (retentionErr) {
        console.error(`[BackupCron] Échec rétention distante "${dest.label || dest.id}" (${dest.type}):`, retentionErr.message);
      }
      results.push({ id: dest.id, label: dest.label, type: dest.type, success: true });
    } catch (err) {
      console.error(`[BackupCron] Échec copie distante "${dest.label || dest.id}" (${dest.type}):`, err.message);
      results.push({ id: dest.id, label: dest.label, type: dest.type, success: false, error: err.message });
    }
  }
  return { results };
}

/**
 * Test de connexion depuis l'UI admin — envoie un petit fichier de test puis
 * le supprime immédiatement, aussi bien en WebDAV qu'en S3. Accepte soit une
 * destination déjà enregistrée (secrets masqués, redécryptés depuis la DB),
 * soit un formulaire pas encore sauvegardé (secrets en clair fournis).
 */
export async function testDestination(payload) {
  const testBuffer = Buffer.from('EbookRequest — test de connexion sauvegarde distante');
  const testFilename = `.ebookrequest-test-${Date.now()}.txt`;

  // Le champ affiche "••••••••" comme simple placeholder HTML (texte indicatif
  // quand le champ est vide) — la vraie valeur reste toujours '' tant que
  // l'admin ne retape rien, jamais la chaîne littérale. Un champ vide/absent
  // doit donc être traité comme "pas fourni", pas comme un vrai secret vide.
  const dest = {
    type: payload.type,
    webdavUrl: payload.webdavUrl,
    webdavUsername: payload.webdavUsername,
    webdavPasswordPlain: payload.webdavPassword && payload.webdavPassword !== '••••••••' ? payload.webdavPassword : undefined,
    s3Endpoint: payload.s3Endpoint,
    s3Bucket: payload.s3Bucket,
    s3Region: payload.s3Region,
    s3AccessKeyId: payload.s3AccessKeyId,
    s3Prefix: payload.s3Prefix,
    s3SecretAccessKeyPlain: payload.s3SecretAccessKey && payload.s3SecretAccessKey !== '••••••••' ? payload.s3SecretAccessKey : undefined,
  };

  // Si un secret est masqué (modification d'une destination déjà enregistrée),
  // va chercher le vrai secret chiffré en DB pour pouvoir le déchiffrer.
  if (payload.id && (dest.webdavPasswordPlain === undefined || dest.s3SecretAccessKeyPlain === undefined)) {
    const existing = (await getDestinations()).find(d => d.id === payload.id);
    if (existing) {
      if (dest.webdavPasswordPlain === undefined) dest.webdavPassword = existing.webdavPassword;
      if (dest.s3SecretAccessKeyPlain === undefined) dest.s3SecretAccessKey = existing.s3SecretAccessKey;
    }
  }

  if (dest.type === 'webdav') {
    if (!dest.webdavUrl) throw new Error('URL WebDAV non configurée.');
    const password = dest.webdavPasswordPlain ?? decrypt(dest.webdavPassword) ?? '';
    const client = createClient(dest.webdavUrl, { username: dest.webdavUsername || '', password });
    await client.putFileContents(testFilename, testBuffer, { overwrite: true });
    await client.deleteFile(testFilename);
  } else if (dest.type === 's3') {
    if (!dest.s3Endpoint || !dest.s3Bucket) throw new Error('Endpoint ou bucket S3 non configuré.');
    const secretAccessKey = dest.s3SecretAccessKeyPlain ?? decrypt(dest.s3SecretAccessKey) ?? '';
    const client = new S3Client({
      endpoint: dest.s3Endpoint,
      region: dest.s3Region || 'auto',
      credentials: { accessKeyId: dest.s3AccessKeyId || '', secretAccessKey },
      forcePathStyle: true,
    });
    const testKey = `${normalizeS3Prefix(dest.s3Prefix)}${testFilename}`;
    await client.send(new PutObjectCommand({ Bucket: dest.s3Bucket, Key: testKey, Body: testBuffer }));
    await client.send(new DeleteObjectCommand({ Bucket: dest.s3Bucket, Key: testKey }));
  } else {
    throw new Error('Type de destination invalide.');
  }
}
