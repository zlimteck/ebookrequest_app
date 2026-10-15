import JSZip from 'jszip';
import { parseStringPromise } from 'xml2js';

/**
 * Extrait titre/auteur depuis les métadonnées OPF embarquées dans un epub.
 *
 * C'est la source que Calibre-Web(-Automated) utilise lui-même pour indexer
 * un livre à l'import (calibredb lit le fichier, pas une API externe type
 * Google Books). Utiliser ce même titre pour la recherche OPDS post-upload
 * (matchCalibreBookId) garantit donc une correspondance fiable, quel que
 * soit le libellé renvoyé par le fournisseur source (Valentine, etc.).
 *
 * Prend directement un Buffer (pas un chemin disque) : le fichier peut venir
 * d'un stockage distant (WebDAV/S3), voir fileStorageService.js (issue #45).
 *
 * @param {Buffer} buffer
 * @param {string} filename pour vérifier l'extension avant de tenter l'extraction
 * @returns {Promise<{title: string, author: string} | null>}
 */
export async function extractEpubMetadata(buffer, filename) {
  if (!buffer || !filename || !filename.toLowerCase().endsWith('.epub')) return null;

  try {
    const zip = await JSZip.loadAsync(buffer);

    const containerFile = zip.file('META-INF/container.xml');
    if (!containerFile) return null;
    const containerXml = await containerFile.async('string');
    const container = await parseStringPromise(containerXml);
    const opfPath = container?.container?.rootfiles?.[0]?.rootfile?.[0]?.$?.['full-path'];
    if (!opfPath) return null;

    const opfFile = zip.file(opfPath);
    if (!opfFile) return null;
    const opfXml = await opfFile.async('string');
    const opf = await parseStringPromise(opfXml);

    const metadata = opf?.package?.metadata?.[0];
    if (!metadata) return null;

    // xml2js garde le préfixe de namespace tel quel ("dc:title"), et un noeud
    // sans attributs est juste une string dans le tableau ; avec attributs
    // (ex: opf:role sur dc:creator) c'est { _: "texte", $: {...} }.
    const getText = (node) => {
      if (!node) return '';
      if (typeof node === 'string') return node.trim();
      if (typeof node === 'object' && typeof node._ === 'string') return node._.trim();
      return '';
    };

    const title = getText(metadata['dc:title']?.[0]);
    const author = getText(metadata['dc:creator']?.[0]);

    if (!title) return null;
    return { title, author: author || '' };
  } catch (err) {
    console.warn(`[EpubMetadata] Extraction échouée pour ${filename}: ${err.message}`);
    return null;
  }
}
