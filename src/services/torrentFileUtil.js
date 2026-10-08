import crypto from 'crypto';

// Avance jusqu'à la fin d'une valeur bencodée à `pos`, quel que soit son type
// (entier, chaîne, liste, dictionnaire) — nécessaire pour localiser les octets
// bruts du dictionnaire "info" sans le décoder en objet JS (le hash BitTorrent
// se calcule sur ses octets exacts, pas sur une reconstruction).
function skipValue(buffer, pos) {
  const c = buffer[pos];
  if (c === 0x69) { // 'i' entier : i<chiffres>e
    const end = buffer.indexOf(0x65, pos);
    return end + 1;
  }
  if (c === 0x6c) { // 'l' liste : l<valeurs>e
    pos++;
    while (buffer[pos] !== 0x65) pos = skipValue(buffer, pos);
    return pos + 1;
  }
  if (c === 0x64) { // 'd' dictionnaire : d<clé><valeur>...e
    pos++;
    while (buffer[pos] !== 0x65) {
      pos = skipValue(buffer, pos); // clé (toujours une chaîne)
      pos = skipValue(buffer, pos); // valeur
    }
    return pos + 1;
  }
  // chaîne : <longueur>:<octets>
  const colon = buffer.indexOf(0x3a, pos);
  const len = parseInt(buffer.toString('latin1', pos, colon), 10);
  return colon + 1 + len;
}

/**
 * Calcule le hash BitTorrent (infohash, 40 caractères hex) d'un fichier
 * .torrent brut, en extrayant les octets exacts de son dictionnaire "info"
 * et en les hashant en SHA1 — la seule façon fiable d'obtenir le même hash
 * que celui utilisé par les clients torrent (qui identifient toujours un
 * torrent par cette valeur).
 */
export function getInfoHashFromTorrentFile(buffer) {
  if (buffer[0] !== 0x64) throw new Error('Fichier .torrent invalide (pas un dictionnaire bencodé)');

  let pos = 1;
  while (buffer[pos] !== 0x65) {
    const colon = buffer.indexOf(0x3a, pos);
    const keyLen = parseInt(buffer.toString('latin1', pos, colon), 10);
    const keyStart = colon + 1;
    const key = buffer.toString('latin1', keyStart, keyStart + keyLen);
    const valueStart = keyStart + keyLen;
    const valueEnd = skipValue(buffer, valueStart);

    if (key === 'info') {
      return crypto.createHash('sha1').update(buffer.slice(valueStart, valueEnd)).digest('hex');
    }
    pos = valueEnd;
  }

  throw new Error('Clé "info" introuvable dans le fichier .torrent');
}
