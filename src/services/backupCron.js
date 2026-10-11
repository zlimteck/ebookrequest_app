import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ConnectorSettings from '../models/ConnectorSettings.js';
import { exportBackup } from './backupService.js';
import { uploadRemoteBackup } from './remoteBackupService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Sous uploads/ (déjà monté en volume Docker, voir docker-compose.yml) plutôt
// qu'un nouveau volume dédié — survit aux redéploiements sans configuration
// supplémentaire côté admin.
export const BACKUP_DIR = path.join(__dirname, '../../uploads/backups');
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

async function getConfig() {
  const doc = await ConnectorSettings.findOne({ service: 'backup' }).lean();
  return doc || { service: 'backup', enabled: false, cronInterval: 24, backupRetentionCount: 7 };
}

export function listBackups() {
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.zip'))
    .map(f => {
      const stat = fs.statSync(path.join(BACKUP_DIR, f));
      return { filename: f, size: stat.size, createdAt: stat.mtime };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

async function runBackupCron() {
  try {
    const config = await getConfig();
    if (!config.enabled) return;

    const zipBuffer = await exportBackup();
    const filename = `ebookrequest-backup-auto-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`;
    fs.writeFileSync(path.join(BACKUP_DIR, filename), zipBuffer);
    console.log(`[BackupCron] Sauvegarde automatique créée : ${filename}`);

    // Rétention : ne garde que les N plus récentes (toutes sauvegardes
    // confondues, auto + export manuel s'il a été placé dans ce dossier).
    const retention = config.backupRetentionCount || 7;

    // Copie vers chaque destination distante active, en plus de la locale,
    // jamais à la place — l'échec d'une destination n'empêche pas les autres
    // d'être tentées ni de garder la sauvegarde locale déjà écrite sur disque
    // (chaque résultat est déjà loggé individuellement dans uploadRemoteBackup).
    // Même rétention appliquée côté distant que côté local.
    await uploadRemoteBackup(zipBuffer, filename, retention).catch(err => {
      console.error('[BackupCron] Échec de la copie distante:', err.message);
    });
    const existing = listBackups();
    for (const old of existing.slice(retention)) {
      fs.unlinkSync(path.join(BACKUP_DIR, old.filename));
      console.log(`[BackupCron] Sauvegarde expirée supprimée : ${old.filename}`);
    }
  } catch (err) {
    console.error('[BackupCron] Erreur:', err.message);
  }
}

let cronIntervalId = null;

export async function startBackupCron() {
  if (cronIntervalId) clearInterval(cronIntervalId);
  const config = await getConfig();
  const intervalHours = config.cronInterval || 24;
  const intervalMs = intervalHours * 60 * 60 * 1000;
  // Premier passage décalé (comme les autres crons) pour ne pas concurrencer
  // le démarrage de l'app, puis à intervalle régulier.
  setTimeout(() => {
    runBackupCron();
    cronIntervalId = setInterval(runBackupCron, intervalMs);
  }, 2 * 60 * 1000);
  console.log(`[BackupCron] Planifié toutes les ${intervalHours}h (si activé).`);
}

// Pour relancer l'intervalle après un changement de réglage côté admin, sans
// redémarrer le serveur — même pattern que restartCronInterval (valentineCron.js).
export async function restartBackupCron() {
  await startBackupCron();
}

export { runBackupCron };
