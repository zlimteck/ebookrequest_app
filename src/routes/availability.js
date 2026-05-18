import express from 'express';
import { checkBookAvailability } from '../services/rssService.js';
import { searchOnValentine } from '../services/valentineService.js';
import { searchOnAnnasArchive } from '../services/annasArchiveService.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

router.post('/check', requireAuth, async (req, res) => {
  try {
    const { title, author } = req.body;

    if (!title || !author) {
      return res.status(400).json({
        success: false,
        message: 'Le titre et l\'auteur sont requis'
      });
    }

    // Lancer les 3 sources en parallèle
    const [predbResult, valentineResult, annasResult] = await Promise.allSettled([
      checkBookAvailability(title, author),
      withTimeout(searchOnValentine(title), 5000),
      withTimeout(searchOnAnnasArchive(title), 5000),
    ]);

    const predb = predbResult.status === 'fulfilled'
      ? predbResult.value
      : { available: false, confidence: 'unknown', message: 'Impossible de vérifier la disponibilité pour le moment' };

    const valentineFound = valentineResult.status === 'fulfilled'
      && Array.isArray(valentineResult.value)
      && valentineResult.value.length > 0;

    const annasFound = annasResult.status === 'fulfilled'
      && Array.isArray(annasResult.value?.results)
      && annasResult.value.results.length > 0;

    const connectorFound = valentineFound || annasFound;

    // Upgrade confidence si un connecteur a trouvé le livre
    const confidence = connectorFound ? 'high' : predb.confidence;
    const available  = connectorFound || predb.available;
    const message    = connectorFound
      ? 'Ce livre est disponible ! Votre demande devrait être traitée rapidement.'
      : predb.message;

    return res.json({
      success: true,
      available,
      confidence,
      message,
      match: predb.match,
      score: predb.score,
    });

  } catch (error) {
    console.error('Erreur lors de la vérification de disponibilité:', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur lors de la vérification de disponibilité',
      available: false,
      confidence: 'unknown'
    });
  }
});

export default router;
