import crypto from 'crypto';

// Génère un secret aléatoire haute entropie (codes, refresh tokens, secrets
// de client) — 32 octets, encodé en base64url pour rester utilisable tel
// quel dans une URL/un header sans échappement.
export function generateOpaqueToken() {
  return crypto.randomBytes(32).toString('base64url');
}

// Hash à sens unique pour la persistance des codes/refresh tokens — jamais
// la valeur en clair en base, seule la valeur présentée par le client est
// re-hachée et comparée à l'enregistrement.
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Comparaison en temps constant, pour tout ce qu'on compare nous-mêmes
// directement (CSRF, hash de token déjà récupéré en base...) plutôt que de
// laisser une simple égalité de chaînes fuiter un timing.
export function timingSafeEqualStrings(a, b) {
  const bufA = Buffer.from(a || '', 'utf8');
  const bufB = Buffer.from(b || '', 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
