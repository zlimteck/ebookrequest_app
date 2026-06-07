/**
 * calibreConvertService.js
 * Conversion de fichiers ebook via ebook-convert (Calibre CLI) installé dans le conteneur.
 * Aucun serveur externe requis — appel direct en subprocess.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONVERT_DIR = path.join(__dirname, '../../uploads/convert');

// Formats supportés par ebook-convert
export const EBOOK_CONVERT_FORMATS = ['epub', 'mobi', 'azw3', 'fb2'];
export const COMIC_CONVERT_FORMATS  = ['pdf']; // via cbzToPdf

function ensureConvertDir() {
  if (!fs.existsSync(CONVERT_DIR)) fs.mkdirSync(CONVERT_DIR, { recursive: true });
}

/**
 * Convertit un ebook via ebook-convert (Calibre CLI).
 * @param {string} filePath  - chemin absolu du fichier source
 * @param {string} fromFormat - format source (ex: 'epub')
 * @param {string} toFormat   - format cible (ex: 'mobi')
 * @param {string} bookTitle  - titre du livre (pour les logs)
 * @returns {string} chemin absolu du fichier converti dans uploads/convert/
 */
export async function convertViaCalibреWeb(filePath, fromFormat, toFormat, bookTitle) {
  ensureConvertDir();

  const outName = `${Date.now()}_${path.basename(filePath, path.extname(filePath))}.${toFormat.toLowerCase()}`;
  const outPath = path.join(CONVERT_DIR, outName);

  // Vérifier que ebook-convert est disponible
  try {
    await execAsync('which ebook-convert');
  } catch {
    throw new Error('ebook-convert n\'est pas disponible sur ce serveur. Contactez l\'administrateur.');
  }

  console.log(`[ebook-convert] ${fromFormat.toUpperCase()} → ${toFormat.toUpperCase()} : ${path.basename(filePath)}`);

  // Qt exige un répertoire runtime en 0700 strict — /tmp ne convient pas (1777)
  const runtimeDir = `/tmp/ebconv-${process.pid}-${Date.now()}`;
  fs.mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });

  const env = {
    ...process.env,
    QT_QPA_PLATFORM: 'offscreen',
    XDG_RUNTIME_DIR: runtimeDir,
    DISPLAY: '',
  };

  try {
    const { stderr } = await execAsync(
      `ebook-convert "${filePath}" "${outPath}"`,
      { timeout: 120000, env }
    );
    if (stderr) console.warn(`[ebook-convert] ${stderr.slice(0, 300)}`);
  } catch (err) {
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    throw new Error(`Conversion échouée : ${err.message?.slice(0, 200) || 'erreur inconnue'}`);
  } finally {
    // Nettoyer le répertoire runtime temporaire
    try { fs.rmSync(runtimeDir, { recursive: true, force: true }); } catch {}
  }

  if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
    throw new Error('Le fichier converti est vide ou absent après conversion');
  }

  console.log(`[ebook-convert] OK → ${outName}`);
  return outPath;
}

export { CONVERT_DIR };