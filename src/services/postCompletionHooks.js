import path from 'path';
import { fileURLToPath } from 'url';
import User from '../models/User.js';
import { pushToCalibre } from './calibreService.js';

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

      await pushToCalibre(user, filePath, request.title);

      request.calibrePush = {
        status: 'success',
        error: null,
        pushedAt: new Date(),
      };
      await request.save();
    } catch (err) {
      console.error(`[Calibre] Erreur push: ${err.message}`);
      request.calibrePush = {
        status: 'failed',
        error: err.message,
        pushedAt: new Date(),
      };
      await request.save();
    }
  }
}