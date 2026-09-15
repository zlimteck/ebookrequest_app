# Politique de confidentialité

**Dernière mise à jour : 12 septembre 2026**

## Un logiciel auto-hébergé, pas un service centralisé

EbookRequest est un logiciel open source distribué sous licence MIT. Chaque instance est déployée et administrée indépendamment par la personne ou l'organisation qui l'installe (ci-après « l'administrateur »). **Ni [@zlimteck](https://github.com/zlimteck) ni les contributeurs du projet n'opèrent de service centralisé, n'ont accès aux données d'aucune instance, et ne sont pas responsables du traitement des données effectué par une instance qu'ils n'administrent pas.**

Si vous utilisez EbookRequest (via le web, l'application iOS ou un client OPDS/MCP), vos données sont hébergées et traitées par l'administrateur de l'instance à laquelle vous êtes connecté : c'est cette personne qu'il faut contacter pour toute question relative à vos données. Cette page décrit ce que **le logiciel** collecte et comment, à titre d'information pour les utilisateurs et pour aider les administrateurs à répondre à leurs propres obligations légales (RGPD ou équivalent).

## Données collectées par le logiciel

### Compte utilisateur
- Nom d'utilisateur, adresse email (optionnelle sauf si créée par un administrateur), mot de passe (haché via `bcrypt`, jamais stocké en clair)
- Adresse email Kindle (optionnelle, pour l'envoi automatique de livres)
- Avatar (optionnel)

### Authentification
- Sessions actives : adresse IP et User-Agent (chiffrés en base via `AES-256-CBC`), horodatage de dernière activité, méthode de connexion (mot de passe, Passkey, 2FA, jeton d'accès)
- Identifiants de Passkey (clé publique WebAuthn, jamais la clé privée — celle-ci ne quitte jamais votre appareil)
- Secret TOTP (2FA), si activée, et codes de récupération associés
- Jeton d'accès personnel (utilisé par l'application iOS, les liseuses OPDS et les intégrations MCP)

### Contenu et usage
- Demandes de livres soumises (titre, auteur, métadonnées, statut, commentaires)
- Bibliothèque de lecture personnelle (statut de lecture, notes, progression)
- Messages échangés avec les administrateurs sur une demande
- Historique d'accès au catalogue OPDS (livre consulté/téléchargé, IP, client utilisé)
- Journal d'envoi des emails (destinataire, statut de livraison)

### Notifications
- Abonnement push navigateur (endpoint, clés de chiffrement, standard Web Push), sans donnée personnelle transmise au navigateur ou à son fournisseur au-delà de ce qui est nécessaire pour router la notification
- URLs Apprise personnelles, si configurées (peuvent pointer vers un service tiers choisi par vous — Pushover, Discord, Telegram...)

### Intégrations tierces optionnelles
Si l'administrateur ou l'utilisateur active ces fonctionnalités, des identifiants ou clés API sont stockés **chiffrés en base** (`AES-256-CBC`) :
- Identifiants Valentine (connecteur de téléchargement)
- URL et identifiants Calibre-Web personnels
- Clé API Hardcover personnelle (synchronisation de bibliothèque)

Ces services tiers reçoivent les requêtes nécessaires à leur fonctionnement (ex. une recherche de titre) selon leurs propres politiques de confidentialité, indépendantes de ce projet.

### Localisation approximative
L'adresse IP associée à une session est utilisée pour une géolocalisation approximative (pays/ville) affichée dans « Sessions actives » et pour détecter une connexion depuis un nouveau pays (alerte de sécurité par email). Cette géolocalisation est calculée **localement** par l'instance elle-même (bibliothèque `geoip-lite`), sans transmission de l'IP à un service tiers.

## Ce que le logiciel ne fait pas

- Pas de télémétrie ni d'analytics envoyés à un tiers ou aux mainteneurs du projet
- Pas de vente ni de partage de données à des fins publicitaires
- Pas de tracking cross-site

Les seuls flux sortants vers des tiers sont ceux explicitement nécessaires aux fonctionnalités activées par l'administrateur ou l'utilisateur (Google Books, Hardcover, Open Library, Anna's Archive, LibGen, Fourtoutici, Calibre-Web, Apprise, fournisseur d'email/SMS, fournisseur IA), chacun régi par sa propre politique de confidentialité.

## Conservation et suppression des données

- Les sessions expirent automatiquement après 30 jours d'inactivité (suppression automatique en base).
- Un utilisateur peut révoquer individuellement chacune de ses sessions actives (y compris les applications tierces utilisant son jeton d'accès) depuis ses paramètres.
- La suppression d'un compte relève de l'administrateur de l'instance concernée — contactez-le directement.

## Application iOS

L'application iOS EbookRequest est un client pour une instance EbookRequest auto-hébergée. Elle ne collecte ni ne transmet aucune donnée à un serveur autre que celui configuré par l'utilisateur (l'instance EbookRequest à laquelle il se connecte). L'authentification par Face ID/Touch ID (Passkey) repose sur le standard WebAuthn : la clé privée est générée et stockée exclusivement dans l'enclave sécurisée de l'appareil, jamais transmise au serveur ni accessible par lui.

## Questions

Pour toute question sur le traitement de vos données sur une instance donnée, contactez l'administrateur de cette instance. Pour toute question sur le code source ou le fonctionnement du logiciel lui-même, ouvrez une issue sur le [dépôt GitHub](https://github.com/zlimteck/ebookrequest_app).
