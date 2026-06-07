/**
 * cbzToPdfService.js
 * Convertit un CBZ ou CBR en PDF en Node.js pur (JSZip + pdfkit).
 * Pas de dépendance à Calibre ou à un service externe.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';
import PDFDocument from 'pdfkit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONVERT_DIR = path.join(__dirname, '../../uploads/convert');

function ensureConvertDir() {
  if (!fs.existsSync(CONVERT_DIR)) fs.mkdirSync(CONVERT_DIR, { recursive: true });
}

/**
 * Lit les dimensions d'une image depuis son buffer (JPEG ou PNG).
 * Retourne { width, height } ou null si non détectable.
 */
function getImageDimensions(buffer) {
  try {
    // PNG: magic bytes 89 50 4E 47 — dimensions à offset 16 (uint32 BE × 2)
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      const w = buffer.readUInt32BE(16);
      const h = buffer.readUInt32BE(20);
      if (w > 0 && h > 0) return { width: w, height: h };
    }
    // JPEG: chercher marqueur SOF0 (FF C0) ou SOF2 (FF C2)
    if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
      let offset = 2;
      while (offset < buffer.length - 9) {
        if (buffer[offset] !== 0xFF) break;
        const marker = buffer[offset + 1];
        const len = buffer.readUInt16BE(offset + 2);
        if (marker === 0xC0 || marker === 0xC2) {
          const h = buffer.readUInt16BE(offset + 5);
          const w = buffer.readUInt16BE(offset + 7);
          if (w > 0 && h > 0) return { width: w, height: h };
        }
        offset += 2 + len;
      }
    }
  } catch {}
  return null;
}

/**
 * Convertit un CBZ/CBR en PDF.
 * @param {string} cbzPath - chemin absolu du fichier CBZ source
 * @param {string} bookTitle - titre du livre (pour le nom du fichier)
 * @returns {string} chemin absolu du PDF généré dans uploads/convert/
 */
export async function cbzToPdf(cbzPath, bookTitle = 'comic') {
  ensureConvertDir();

  const data = fs.readFileSync(cbzPath);

  let zip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    // CBR = RAR natif, non supporté par JSZip
    throw new Error(
      'Le format CBR (RAR) n\'est pas supporté pour la conversion en PDF. ' +
      'Convertissez d\'abord votre fichier en CBZ (renommez l\'extension si l\'archive est déjà un ZIP).'
    );
  }

  const imageFiles = Object.values(zip.files)
    .filter(f => !f.dir && /\.(jpe?g|png)$/i.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  if (!imageFiles.length) throw new Error('Aucune image trouvée dans le fichier CBZ');

  const outName = `${Date.now()}_${path.basename(cbzPath, path.extname(cbzPath))}.pdf`;
  const outPath = path.join(CONVERT_DIR, outName);

  const doc = new PDFDocument({ autoFirstPage: false, margin: 0 });
  const writeStream = fs.createWriteStream(outPath);
  doc.pipe(writeStream);

  for (const imgFile of imageFiles) {
    const imgBuffer = await imgFile.async('nodebuffer');
    const dims = getImageDimensions(imgBuffer);

    if (dims) {
      // Page aux dimensions exactes de l'image
      doc.addPage({ size: [dims.width, dims.height], margin: 0 });
      doc.image(imgBuffer, 0, 0, { width: dims.width, height: dims.height });
    } else {
      // Fallback A4 avec fit centré
      doc.addPage({ size: 'A4', layout: 'portrait', margin: 0 });
      doc.image(imgBuffer, 0, 0, {
        fit: [doc.page.width, doc.page.height],
        align: 'center',
        valign: 'center',
      });
    }
  }

  doc.end();

  return new Promise((resolve, reject) => {
    writeStream.on('finish', () => resolve(outPath));
    writeStream.on('error', reject);
  });
}