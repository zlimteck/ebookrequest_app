/**
 * Retourne la couleur du rond d'avatar selon le rôle et le compte Valentine.
 *   - admin       → rouge
 *   - user Valentine → vert
 *   - user normal  → bleu
 *
 * @param {{ role?: string, hasValentine?: boolean }} user
 */
export function getAvatarColor({ role, hasValentine } = {}) {
  if (role === 'admin') return '#ef4444';
  if (hasValentine) return '#10b981';
  return '#3b82f6';
}