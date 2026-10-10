import { createClient } from 'webdav';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import ConnectorSettings from '../models/ConnectorSettings.js';
import { decrypt } from './cryptoService.js';

async function getConfig() {
  const doc = await ConnectorSettings.findOne({ service: 'backup' }).lean();
  return doc || {};
}

async function uploadToWebdav(buffer, filename, config) {
  if (!config.remoteBackupWebdavUrl) throw new Error('URL WebDAV non configurée.');
  const password = decrypt(config.password) ?? '';
  const client = createClient(config.remoteBackupWebdavUrl, {
    username: config.remoteBackupWebdavUsername || '',
    password,
  });
  await client.putFileContents(filename, buffer, { overwrite: true });
}

async function uploadToS3(buffer, filename, config) {
  if (!config.remoteBackupS3Endpoint || !config.remoteBackupS3Bucket) {
    throw new Error('Endpoint ou bucket S3 non configuré.');
  }
  const secretAccessKey = decrypt(config.apiKey) ?? '';
  const client = new S3Client({
    endpoint: config.remoteBackupS3Endpoint,
    region: config.remoteBackupS3Region || 'auto',
    credentials: {
      accessKeyId: config.remoteBackupS3AccessKeyId || '',
      secretAccessKey,
    },
    // Requis par la plupart des fournisseurs S3-compatibles hors AWS (Hetzner
    // Object Storage, Backblaze B2, MinIO...) — sans ça le SDK génère des URLs
    // virtual-hosted-style (bucket.endpoint) que ces fournisseurs ne servent pas.
    forcePathStyle: true,
  });
  await client.send(new PutObjectCommand({
    Bucket: config.remoteBackupS3Bucket,
    Key: filename,
    Body: buffer,
  }));
}

/**
 * Copie une sauvegarde déjà écrite en local vers la destination distante
 * configurée, si elle l'est — ne remplace jamais la copie locale, s'ajoute à
 * elle (issue #43, suite). No-op silencieux si remoteBackupType est vide.
 */
export async function uploadRemoteBackup(buffer, filename) {
  const config = await getConfig();
  if (!config.remoteBackupType) return { skipped: true };

  if (config.remoteBackupType === 'webdav') {
    await uploadToWebdav(buffer, filename, config);
  } else if (config.remoteBackupType === 's3') {
    await uploadToS3(buffer, filename, config);
  }
  return { skipped: false, type: config.remoteBackupType };
}

/**
 * Test de connexion depuis l'UI admin — envoie un petit fichier de test puis
 * le supprime immédiatement, aussi bien en WebDAV qu'en S3.
 */
export async function testRemoteBackupConnection(config) {
  const testBuffer = Buffer.from('EbookRequest — test de connexion sauvegarde distante');
  const testFilename = `.ebookrequest-test-${Date.now()}.txt`;

  if (config.remoteBackupType === 'webdav') {
    if (!config.remoteBackupWebdavUrl) throw new Error('URL WebDAV non configurée.');
    const password = config.remoteBackupPasswordPlain
      ? config.remoteBackupPasswordPlain
      : decrypt((await getConfig()).password) ?? '';
    const client = createClient(config.remoteBackupWebdavUrl, {
      username: config.remoteBackupWebdavUsername || '',
      password,
    });
    await client.putFileContents(testFilename, testBuffer, { overwrite: true });
    await client.deleteFile(testFilename);
  } else if (config.remoteBackupType === 's3') {
    if (!config.remoteBackupS3Endpoint || !config.remoteBackupS3Bucket) {
      throw new Error('Endpoint ou bucket S3 non configuré.');
    }
    const secretAccessKey = config.remoteBackupS3SecretPlain
      ? config.remoteBackupS3SecretPlain
      : decrypt((await getConfig()).apiKey) ?? '';
    const client = new S3Client({
      endpoint: config.remoteBackupS3Endpoint,
      region: config.remoteBackupS3Region || 'auto',
      credentials: { accessKeyId: config.remoteBackupS3AccessKeyId || '', secretAccessKey },
      forcePathStyle: true,
    });
    await client.send(new PutObjectCommand({
      Bucket: config.remoteBackupS3Bucket,
      Key: testFilename,
      Body: testBuffer,
    }));
    await client.send(new DeleteObjectCommand({
      Bucket: config.remoteBackupS3Bucket,
      Key: testFilename,
    }));
  } else {
    throw new Error('Aucune destination distante sélectionnée.');
  }
}
