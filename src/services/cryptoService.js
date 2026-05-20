import crypto from 'crypto';

// Derive a 32-byte key from JWT_SECRET
const getKey = () => {
  const secret = process.env.JWT_SECRET || 'default-secret';
  return crypto.createHash('sha256').update(secret).digest();
};

/**
 * Encrypt a plaintext string using AES-256-CBC.
 * Returns "iv:encrypted" (both hex-encoded), or null if text is falsy.
 */
export function encrypt(text) {
  if (!text) return null;
  const key = getKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt a string previously encrypted with encrypt().
 * Returns the plaintext, or null if value is falsy or decryption fails.
 */
export function decrypt(text) {
  if (!text) return null;
  try {
    const [ivHex, encryptedHex] = text.split(':');
    if (!ivHex || !encryptedHex) return null;
    const key = getKey();
    const iv = Buffer.from(ivHex, 'hex');
    const encryptedBuffer = Buffer.from(encryptedHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    const decrypted = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}