// Labels des flags secrets (voir src/routes/flags.js), centralisés ici pour que
// achievementsService.js puisse les afficher une fois trouvés sans dupliquer les
// chaînes. Les slugs non présents dans User.unlockedFlags ne sont jamais exposés :
// un flag reste invisible tant qu'il n'a pas été débloqué.
export const FLAG_LABELS = {
  zlimteck: 'Message du développeur',
  matrix: 'La Matrice',
  teapot: 'Je suis une théière',
  curlOnly: 'Pur et dur en ligne de commande',
  base64: 'Décodeur amateur',
  konami: 'Code Konami',
  oneShot: 'Premier arrivé',
  secretPhrase: 'Le mot de passe du chatbot',
};

// Phrase cachée dans le payload décodé du flag base64 (voir routes/flags.js) : rien
// n'indique à quoi elle sert, il faut deviner qu'il faut la glisser dans un message au
// chatbot IA pour débloquer le flag 'secretPhrase' (voir routes/chatbot.js).
export const SECRET_PHRASE = "sésame ouvre-toi, base64";
