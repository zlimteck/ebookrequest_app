import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { unlockFlag } from '../services/flagService.js';
import { FLAG_LABELS, SECRET_PHRASE } from '../constants/flags.js';

// Mini-CTF caché : routes volontairement absentes d'API.md, trouvables seulement en
// fouillant (réseau, essais, bouche-à-oreille). Chaque flag ne se débloque qu'une
// fois par compte (sticky, comme les autres succès) et déclenche la même notification
// cloche + push que le reste du système de succès, via le type 'achievement_unlocked'
// déjà filtré "Trophées" côté app — pas besoin d'un nouveau type ni d'UI dédiée.
const router = express.Router();

router.get('/zlimteck', requireAuth, async (req, res) => {
  await unlockFlag(req.user.id, 'zlimteck', FLAG_LABELS.zlimteck);
  res.type('text/plain').send(
    "Salut, et merci d'avoir fouillé jusqu'ici.\n" +
    "EbookRequest est un projet perso, codé sur mon temps libre parce que j'aime bien" +
    " que les choses marchent comme je veux qu'elles marchent.\n" +
    "Si t'as trouvé ce endpoint, t'es exactement le genre de curieux pour qui ce genre" +
    " de petit secret existe. Bonne chasse pour la suite.\n\n-- zlimteck"
  );
});

router.get('/matrix', requireAuth, async (req, res) => {
  await unlockFlag(req.user.id, 'matrix', FLAG_LABELS.matrix);
  const chars = 'アァカサタナハマヤャラワガザダバパ0123456789';
  const cols = 60, rows = 16;
  let rain = '';
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      line += Math.random() < 0.35 ? chars[Math.floor(Math.random() * chars.length)] : ' ';
    }
    rain += line + '\n';
  }
  res.type('text/plain').send(`${rain}\nWake up, Neo...\nThe EbookRequest has you.\nFollow the white rabbit.\n`);
});

router.get('/teapot', requireAuth, async (req, res) => {
  await unlockFlag(req.user.id, 'teapot', FLAG_LABELS.teapot);
  res.status(418).type('text/plain').send(
    '     ( (\n' +
    '      ) )\n' +
    '   ........\n' +
    "   |      |]\n" +
    '   \\      /\n' +
    "    `----'\n" +
    "418 I'm a teapot\nOn ne brasse pas de livres dans une théière.\n"
  );
});

router.get('/curl-only', requireAuth, async (req, res) => {
  const ua = req.headers['user-agent'] || '';
  if (!ua.toLowerCase().startsWith('curl/')) {
    return res.type('text/plain').send("Essaie depuis un vrai terminal, pas un navigateur. Indice : curl.\n");
  }
  await unlockFlag(req.user.id, 'curlOnly', FLAG_LABELS.curlOnly);
  res.type('text/plain').send("Respect. User-Agent curl détecté, pas de navigateur qui triche ici.\n");
});

// Le payload décodé n'est pas un message de félicitations : c'est une phrase à glisser
// quelque part ailleurs dans l'app (voir routes/chatbot.js) pour débloquer un second
// flag — aucune explication donnée ici, à deviner/essayer soi-même.
router.get('/base64', requireAuth, async (req, res) => {
  await unlockFlag(req.user.id, 'base64', FLAG_LABELS.base64);
  const secret = Buffer.from(SECRET_PHRASE).toString('base64');
  res.json({ hint: 'ceci est encodé, pas chiffré', payload: secret });
});

router.get('/konami', requireAuth, async (req, res) => {
  if (req.query.code !== 'up-up-down-down-left-right-left-right-b-a') {
    return res.status(404).end();
  }
  await unlockFlag(req.user.id, 'konami', FLAG_LABELS.konami);
  res.type('text/plain').send('Haut haut bas bas gauche droite gauche droite B A. Le classique.\n30 vies, zéro regret.\n');
});

router.get('/one-shot', requireAuth, async (req, res) => {
  const isNew = await unlockFlag(req.user.id, 'oneShot', FLAG_LABELS.oneShot);
  if (!isNew) {
    return res.status(410).type('text/plain').send("Trop tard. Ce flag ne se prend qu'une fois, et c'était la dernière.\n");
  }
  res.type('text/plain').send("Tu ne repasseras qu'une fois par ici. Profites-en.\n");
});

export default router;
