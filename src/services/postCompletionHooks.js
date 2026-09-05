import path from 'path';
import { fileURLToPath } from 'url';
import User from '../models/User.js';
import { pushToCalibre, pushBookToUserShelves, resolveCalibreBookId } from './calibreService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Run all post-completion hooks for a book request.
 * @param {object} request - Mongoose BookRequest document (already saved as completed)
 * @param {string|object} userId - The user ID (request.user)
 */
export async function runPostCompletionHooks(request, userId) {
  const user = await User.findById(userId).select('calibreWeb');
  if (!user) return;

  // ── Calibre-Web push ────────────────────────────────────────────────────────
  if (user.calibreWeb?.enabled) {
    try {
      // Build absolute path from the relative filePath stored on the request
      // filePath is like "books/Frieren T05.mobi"
      const relativePath = request.filePath || '';
      const filePath = path.join(__dirname, '../../uploads', relativePath);

      // Étagères choisies au moment de la demande ; à défaut (anciennes
      // demandes, ou demande créée avant que l'utilisateur n'ait configuré
      // d'étagères), on retombe sur les étagères par défaut actuelles.
      const shelfNames = request.selectedShelves !== undefined
        ? request.selectedShelves
        : (user.calibreWeb.shelves || []).filter(s => s.isDefault).map(s => s.name);

      const result = await pushToCalibre(user, filePath, request.title, shelfNames);

      // Upload réussi mais au moins une étagère en échec → 'partial', pour
      // que le bouton "envoyer vers étagères" puisse cibler juste ce qui manque
      // sans reproposer un ré-upload complet.
      const hasShelfFailures = result?.shelfResult?.failed?.length > 0;

      request.calibrePush = {
        status: hasShelfFailures ? 'partial' : 'success',
        error: hasShelfFailures
          ? `Étagère(s) en échec : ${result.shelfResult.failed.map(f => f.name).join(', ')}`
          : null,
        pushedAt: new Date(),
        calibreBookId: result?.calibreBookId ?? null,
      };
      await request.save();
    } catch (err) {
      console.error(`[Calibre] Erreur push: ${err.message}`);
      request.calibrePush = {
        status: 'failed',
        error: err.message,
        pushedAt: new Date(),
        calibreBookId: null,
      };
      await request.save();
    }
  }

  // ── Push vers les étagères additionnelles (multishelf multi-utilisateurs) ──
  // Choisies par un admin, indépendamment de la config Calibre-Web du
  // propriétaire de la demande — chaque cible a son propre compte.
  if (request.extraShelfTargets?.length) {
    // calibreBookId déjà obtenu ci-dessus si le propriétaire a Calibre activé ;
    // sinon on tente de le résoudre via le premier compte cible valide.
    let calibreBookId = request.calibrePush?.calibreBookId || null;

    if (!calibreBookId) {
      for (const target of request.extraShelfTargets) {
        const targetUser = await User.findById(target.user).select('calibreWeb username');
        const cfg = targetUser?.calibreWeb;
        if (!cfg?.enabled || !cfg?.url) continue;
        try {
          const { decrypt } = await import('./cryptoService.js');
          const password = decrypt(cfg.password || '') ?? cfg.password;
          calibreBookId = await resolveCalibreBookId(request, cfg.url.replace(/\/$/, ''), cfg.username, password);
          if (calibreBookId) break;
        } catch (e) {
          console.error(`[Calibre] Résolution calibreBookId (cible additionnelle) échouée: ${e.message}`);
        }
      }
    }

    if (calibreBookId) {
      for (const target of request.extraShelfTargets) {
        try {
          const targetUser = await User.findById(target.user).select('calibreWeb username');
          if (!targetUser?.calibreWeb?.enabled || !targetUser.calibreWeb?.url) {
            target.status = 'failed';
            target.error = 'Calibre-Web non configuré pour cet utilisateur';
            target.pushedAt = new Date();
            continue;
          }
          const shelfResult = await pushBookToUserShelves(targetUser, calibreBookId, target.shelves, target.shelves);
          target.status = shelfResult.failed.length ? 'partial' : 'success';
          target.error = shelfResult.failed.length
            ? `Étagère(s) en échec : ${shelfResult.failed.map(f => f.name).join(', ')}`
            : null;
          target.pushedAt = new Date();
        } catch (err) {
          console.error(`[Calibre] Erreur push étagère additionnelle (${target.username || target.user}): ${err.message}`);
          target.status = 'failed';
          target.error = err.message;
          target.pushedAt = new Date();
        }
      }
    } else {
      console.warn(`[Calibre] Cibles additionnelles ignorées pour "${request.title}" — calibreBookId introuvable`);
      for (const target of request.extraShelfTargets) {
        target.status = 'failed';
        target.error = 'Livre introuvable côté Calibre-Web';
        target.pushedAt = new Date();
      }
    }

    request.markModified('extraShelfTargets');
    await request.save();
  }
}