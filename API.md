# EbookRequest — Référence API

Toutes les routes sont préfixées par `/api`. L'authentification se fait via le header `Authorization: Bearer <token>`.

Deux types de tokens sont acceptés :

- **JWT** — obtenu via `/api/auth/login`. Expire après un certain délai.
- **Token d'accès** — token personnel stable (sans expiration), visible dans **Paramètres → Token d'accès**. Utilisable comme Bearer sur toutes les routes authentifiées. Pratique pour les intégrations externes (scripts, raccourcis, MCP, applications tierces).

```bash
curl https://app.ndd.fr/api/requests/quota \
  -H "Authorization: Bearer <token>"
```

---

## Authentification

### `POST /api/auth/login`
```bash
curl -X POST https://app.ndd.fr/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "alice", "password": "monmotdepasse"}'
```

### `POST /api/auth/register`
```bash
curl -X POST https://app.ndd.fr/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username": "alice", "password": "monmotdepasse", "email": "alice@exemple.fr", "invitationToken": "abc123"}'
```

### `POST /api/auth/forgot-password`
```bash
curl -X POST https://app.ndd.fr/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email": "alice@exemple.fr"}'
```

### `POST /api/auth/reset-password/:token`
```bash
curl -X POST https://app.ndd.fr/api/auth/reset-password/TOKEN \
  -H "Content-Type: application/json" \
  -d '{"password": "nouveaumotdepasse"}'
```

### `GET /api/auth/check-token`
```bash
curl https://app.ndd.fr/api/auth/check-token \
  -H "Authorization: Bearer <token>"
```

### Double authentification (2FA)

Si un compte est protégé par la 2FA, `/api/auth/login` retourne `{"requires2FA": true, "tempToken": "..."}` au lieu du JWT final. Il faut alors valider le code TOTP :

### `POST /api/auth/2fa/verify-login`
```bash
curl -X POST https://app.ndd.fr/api/auth/2fa/verify-login \
  -H "Content-Type: application/json" \
  -d '{"tempToken": "<tempToken>", "code": "123456"}'
```

### `POST /api/auth/2fa/recover` — Utiliser un code de récupération
```bash
curl -X POST https://app.ndd.fr/api/auth/2fa/recover \
  -H "Content-Type: application/json" \
  -d '{"tempToken": "<tempToken>", "recoveryCode": "ABCD-EFGH"}'
```

### `GET /api/auth/2fa/setup` — Obtenir le QR code (activation)
```bash
curl https://app.ndd.fr/api/auth/2fa/setup \
  -H "Authorization: Bearer <token>"
```

### `POST /api/auth/2fa/verify-setup` — Confirmer l'activation
```bash
curl -X POST https://app.ndd.fr/api/auth/2fa/verify-setup \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"code": "123456"}'
```

### `POST /api/auth/2fa/disable`
```bash
curl -X POST https://app.ndd.fr/api/auth/2fa/disable \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"password": "monmotdepasse"}'
```

---

## Profil utilisateur

### `GET /api/users/me`
```bash
curl https://app.ndd.fr/api/users/me \
  -H "Authorization: Bearer <token>"
```

### `GET /api/users/me/stats`
```bash
curl https://app.ndd.fr/api/users/me/stats \
  -H "Authorization: Bearer <token>"
```

### `GET /api/users/me/export`
Export de toutes les données personnelles de l'utilisateur connecté au format JSON (portabilité RGPD) : compte (sans secrets ni mots de passe), demandes de livres, bibliothèque de lecture, sessions actives (IP et user-agent déchiffrés).
```bash
curl -OJ https://app.ndd.fr/api/users/me/export \
  -H "Authorization: Bearer <token>"
```

### `DELETE /api/users/me`
Auto-suppression du compte connecté (compte, demandes, bibliothèque de lecture, jetons de notification push, sessions actives). Les fichiers ebook déjà téléchargés sur le disque ne sont pas supprimés. Confirmation obligatoire dans le corps de la requête : le mot `confirme` (variantes `confirmé`/`confirmer` acceptées), insensible à la casse et aux accents. Refusé pour un compte administrateur (`403`).
```bash
curl -X DELETE https://app.ndd.fr/api/users/me \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"confirmation": "confirme"}'
```

### `PUT /api/users/profile`
```bash
curl -X PUT https://app.ndd.fr/api/users/profile \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"email": "alice@exemple.fr"}'
```

### `PUT /api/users/change-password`
```bash
curl -X PUT https://app.ndd.fr/api/users/change-password \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"currentPassword": "ancien", "newPassword": "nouveau"}'
```

### `GET /api/users/opds-token`
```bash
curl https://app.ndd.fr/api/users/opds-token \
  -H "Authorization: Bearer <token>"
```

### `POST /api/users/opds-token/regenerate`
```bash
curl -X POST https://app.ndd.fr/api/users/opds-token/regenerate \
  -H "Authorization: Bearer <token>"
```

### `GET /api/users/valentine/quota`
Quota de téléchargements Valentine restants. Utilise le compte personnel de l'utilisateur s'il en a configuré un (`source: "own"`), sinon le compte admin partagé (`source: "admin"`). Dans ce second cas, si une limite personnelle est configurée par un admin (`User.valentineDirectLimit`), la réponse inclut aussi `personalLimit: { limit, used, remaining, days }`, la part que cet utilisateur peut consommer sur le compte partagé, sur une fenêtre glissante de `days` jours.
```bash
curl https://app.ndd.fr/api/users/valentine/quota \
  -H "Authorization: Bearer <token>"
```

---

## Demandes de livres

### `GET /api/requests/my-requests`
```bash
curl https://app.ndd.fr/api/requests/my-requests \
  -H "Authorization: Bearer <token>"
```

### `GET /api/requests/quota`
```bash
curl https://app.ndd.fr/api/requests/quota \
  -H "Authorization: Bearer <token>"
```

### `POST /api/requests`
Seuls `title` et `author` sont obligatoires — les autres champs (`link`, `thumbnail`, `description`, `pageCount`...) sont optionnels.
```bash
curl -X POST https://app.ndd.fr/api/requests \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Dune",
    "author": "Frank Herbert",
    "format": "epub",
    "category": "ebook",
    "link": "https://books.google.com/...",
    "thumbnail": "https://...",
    "description": "...",
    "pageCount": 688
  }'
```

### `GET /api/requests/check-duplicate?title=Dune&author=Frank+Herbert`
```bash
curl "https://app.ndd.fr/api/requests/check-duplicate?title=Dune&author=Frank+Herbert" \
  -H "Authorization: Bearer <token>"
```

### `GET /api/requests/direct-search-status`
Indique si la recherche directe sur Valentine (bypass du workflow demande/attente) est activée par un admin.
```bash
curl https://app.ndd.fr/api/requests/direct-search-status \
  -H "Authorization: Bearer <token>"
```

### `GET /api/requests/valentine-source-status` / `GET /api/requests/fourtoutici-source-status`
Indique si la source Valentine / Fourtoutici est activée côté connecteur, pour que le front masque l'onglet correspondant dans la recherche directe (indépendant de `direct-search-status` ci-dessus, qui coupe toute la fonctionnalité).
```bash
curl https://app.ndd.fr/api/requests/fourtoutici-source-status \
  -H "Authorization: Bearer <token>"
```

### `GET /api/requests/fourtoutici-search?q=Dune`
Recherche directe et immédiate sur Fourtoutici (champ unique, pas de mode auteur/série).
```bash
curl "https://app.ndd.fr/api/requests/fourtoutici-search?q=Dune" \
  -H "Authorization: Bearer <token>"
```

### `GET /api/requests/direct-search?mode=title|author|series&q=...`
Recherche immédiate sur Valentine. En mode `title`, renvoie une liste de livres directement téléchargeables. En mode `author`/`series`, renvoie une liste de fiches à explorer ensuite via `direct-search-books`. Utilise le compte Valentine personnel de l'utilisateur s'il en a configuré un (**Paramètres**), sinon le compte admin partagé, idem pour `direct-search-books` et `direct-download`.
```bash
curl "https://app.ndd.fr/api/requests/direct-search?mode=title&q=Dune" \
  -H "Authorization: Bearer <token>"
```

### `GET /api/requests/direct-search-books?type=author|series&url=...&name=...`
Liste les livres d'une fiche auteur/série trouvée via `direct-search`.
```bash
curl "https://app.ndd.fr/api/requests/direct-search-books?type=author&url=/auteur/frank-herbert" \
  -H "Authorization: Bearer <token>"
```

### `POST /api/requests/direct-download`
Crée la demande et télécharge immédiatement le livre choisi (réponse synchrone), avec choix optionnel des étagères Calibre-Web cibles. Pour Valentine, utiliser `ebookId` ; pour Fourtoutici, ajouter `"source": "fourtoutici"` et utiliser `fileId` à la place.
```bash
curl -X POST https://app.ndd.fr/api/requests/direct-download \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "ebookId": "12345",
    "title": "Dune",
    "author": "Frank Herbert",
    "link": "https://valentine.wtf/...",
    "publishedDate": "1965",
    "category": "ebook",
    "selectedShelves": ["Fantasy"]
  }'
```

```bash
curl -X POST https://app.ndd.fr/api/requests/direct-download \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "fourtoutici",
    "fileId": "67890",
    "title": "Dune",
    "author": "Frank Herbert",
    "category": "ebook"
  }'
```

### `DELETE /api/requests/:id`
```bash
curl -X DELETE https://app.ndd.fr/api/requests/ID \
  -H "Authorization: Bearer <token>"
```

### `PATCH /api/requests/:id/user-edit`
```bash
curl -X PATCH https://app.ndd.fr/api/requests/ID/user-edit \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"format": "mobi"}'
```

### `PATCH /api/requests/:id/user-comment`
```bash
curl -X PATCH https://app.ndd.fr/api/requests/ID/user-comment \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"userComment": "Édition française de préférence"}'
```

### `POST /api/requests/:id/comments`
Envoie un message dans le fil de conversation de la demande (user ou admin).
```bash
curl -X POST https://app.ndd.fr/api/requests/ID/comments \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"text": "Avez-vous une préférence pour le format ?"}'
```

### `POST /api/requests/:id/comments/seen`
Marque tous les messages du fil comme lus pour l'utilisateur connecté.
```bash
curl -X POST https://app.ndd.fr/api/requests/ID/comments/seen \
  -H "Authorization: Bearer <token>"
```

### `POST /api/requests/:id/report`
```bash
curl -X POST https://app.ndd.fr/api/requests/ID/report \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Mauvaise édition"}'
```

### `GET /api/requests/download/:id`
```bash
curl -OJ https://app.ndd.fr/api/requests/download/ID \
  -H "Authorization: Bearer <token>"
```

### `POST /api/requests/:id/send-email`
Envoie le fichier d'une demande complétée par email en pièce jointe (20 Mo max, sinon `413`), vers l'adresse du compte authentifié (`useOwnEmail: true`, résolue côté serveur) ou vers une adresse libre (`email`). Accessible au propriétaire de la demande pour ses propres demandes, et à un admin pour n'importe quelle demande. Limité par `emailSendLimit`/`emailSendLimitDays` (voir `PUT /api/admin/users/:id`), jamais pour un admin. Marque la demande comme téléchargée (`downloadedAt`), aucun autre moyen de le savoir une fois le fichier envoyé par email.
```bash
curl -X POST https://app.ndd.fr/api/requests/ID/send-email \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"useOwnEmail": true}'
```
```bash
curl -X POST https://app.ndd.fr/api/requests/ID/send-email \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"email": "ami@exemple.fr"}'
```

### `GET /api/requests/:id/convert-formats`
```bash
curl https://app.ndd.fr/api/requests/ID/convert-formats \
  -H "Authorization: Bearer <token>"
```

### `POST /api/requests/:id/convert?format=mobi`
```bash
curl -X POST "https://app.ndd.fr/api/requests/ID/convert?format=mobi" \
  -H "Authorization: Bearer <token>" -OJ
```

---

## Bibliothèque de lecture

### `GET /api/reading`
```bash
curl "https://app.ndd.fr/api/reading?status=reading" \
  -H "Authorization: Bearer <token>"
```
Paramètre optionnel : `status` (`to_read`, `reading`, `read`)

### `POST /api/reading`
```bash
curl -X POST https://app.ndd.fr/api/reading \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"requestId": "ID", "status": "to_read"}'
```

### `PUT /api/reading/:id`
Tous les champs sont optionnels (`status`, `rating`, `epubLocation`, `readingProgress`, `notes`, `thumbnail`).
```bash
curl -X PUT https://app.ndd.fr/api/reading/ID \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"status": "read", "rating": 5, "notes": "Excellent !", "readingProgress": 100, "thumbnail": "https://..."}'
```

### `DELETE /api/reading/:id`
```bash
curl -X DELETE https://app.ndd.fr/api/reading/ID \
  -H "Authorization: Bearer <token>"
```

---

## Disponibilité

### `POST /api/availability/check`
```bash
curl -X POST https://app.ndd.fr/api/availability/check \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"title": "Dune", "author": "Frank Herbert"}'
```

---

## Notifications

### `GET /api/notifications/history`
```bash
curl https://app.ndd.fr/api/notifications/history \
  -H "Authorization: Bearer <token>"
```

### `GET /api/notifications/unseen`
```bash
curl https://app.ndd.fr/api/notifications/unseen \
  -H "Authorization: Bearer <token>"
```

### `POST /api/notifications/:requestId/seen`
```bash
curl -X POST https://app.ndd.fr/api/notifications/ID/seen \
  -H "Authorization: Bearer <token>"
```

---

## Notifications push

### `GET /api/push/vapid-key`
Clé publique VAPID pour l'abonnement Web Push (navigateurs).
```bash
curl https://app.ndd.fr/api/push/vapid-key \
  -H "Authorization: Bearer <token>"
```

### `POST /api/push/subscribe`
```bash
curl -X POST https://app.ndd.fr/api/push/subscribe \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"subscription": {"endpoint": "...", "keys": {"p256dh": "...", "auth": "..."}}}'
```

### `POST /api/push/unsubscribe`
```bash
curl -X POST https://app.ndd.fr/api/push/unsubscribe \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"endpoint": "..."}'
```

### `GET /api/push/status`
Indique si l'utilisateur a une souscription Web Push active.
```bash
curl https://app.ndd.fr/api/push/status \
  -H "Authorization: Bearer <token>"
```

### `GET /api/push/apns-status`
Indique si le serveur est configuré pour envoyer du push natif iOS (APNs), en direct ou via un relais.
```bash
curl https://app.ndd.fr/api/push/apns-status \
  -H "Authorization: Bearer <token>"
```

### `POST /api/push/apns/register`
Enregistre le jeton d'appareil APNs de l'app iOS (upsert par token : un appareil reconnecté sous un autre compte repointe automatiquement vers le nouvel utilisateur).
```bash
curl -X POST https://app.ndd.fr/api/push/apns/register \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"token": "<jeton APNs de l'\''appareil>"}'
```

### `POST /api/push/apns/unregister`
```bash
curl -X POST https://app.ndd.fr/api/push/apns/unregister \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"token": "<jeton APNs de l'\''appareil>"}'
```

---

## Recherche Google Books

### `GET /api/books/search`
```bash
curl "https://app.ndd.fr/api/books/search?q=Dune&author=Frank+Herbert" \
  -H "Authorization: Bearer <token>"
```

---

## Recommandations IA

### `GET /api/recommendations`
```bash
curl https://app.ndd.fr/api/recommendations \
  -H "Authorization: Bearer <token>"
```

### `POST /api/recommendations/regenerate`
```bash
curl -X POST https://app.ndd.fr/api/recommendations/regenerate \
  -H "Authorization: Bearer <token>"
```

---

## Calibre-Web

### `GET /api/users/calibre`
```bash
curl https://app.ndd.fr/api/users/calibre \
  -H "Authorization: Bearer <token>"
```

### `PUT /api/users/calibre`
```bash
curl -X PUT https://app.ndd.fr/api/users/calibre \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "url": "http://calibre.ndd.fr", "username": "admin", "password": "pass", "shelfName": "EbookRequest"}'
```

### `POST /api/users/calibre/test`
```bash
curl -X POST https://app.ndd.fr/api/users/calibre/test \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"url": "http://calibre.ndd.fr", "username": "admin", "password": "pass"}'
```

### `POST /api/users/calibre/sync`
Traite en tâche de fond les demandes complétées non synchronisées. Répond immédiatement avec `{started, total}` (ou `{started: false, total: 0}` s'il n'y a rien à faire) ; le résultat final (`{pushed, failed, skipped, total, lastSync}`) arrive via l'événement Socket.IO `calibre:sync-done`, adressé à l'utilisateur.
```bash
curl -X POST https://app.ndd.fr/api/users/calibre/sync \
  -H "Authorization: Bearer <token>"
```

### `GET /api/users/calibre/requests/:id/shelves`
État réel (live) des étagères Calibre-Web pour une demande. Un admin peut consulter celles du propriétaire de la demande (pas uniquement les siennes).
```bash
curl https://app.ndd.fr/api/users/calibre/requests/64f.../shelves \
  -H "Authorization: Bearer <token>"
```

### `POST /api/users/calibre/requests/:id/shelves`
Pousse/corrige les étagères d'une demande déjà complétée. Utilise le `calibreBookId` déjà connu si disponible, sinon retrouve le livre par titre ; si toujours introuvable, envoie l'upload complet vers Calibre-Web. Un admin peut agir pour le compte du propriétaire de la demande, pas seulement le sien.
```bash
curl -X POST https://app.ndd.fr/api/users/calibre/requests/64f.../shelves \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"shelves": ["Romans", "À lire"]}'
```

### `POST /api/requests/:id/extra-shelves` (admin)
Pousse une demande complétée vers les étagères Calibre-Web d'un ou plusieurs comptes additionnels (et, depuis peu, celles du propriétaire de la demande lui-même). Upload complet automatique si le livre n'est retrouvé chez aucun des comptes ciblés.
```bash
curl -X POST https://app.ndd.fr/api/requests/64f.../extra-shelves \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"targets": [{"userId": "64f...", "shelves": ["Romans"]}]}'
```

### `GET /api/users/hardcover`
Config personnelle de synchro bibliothèque (clé API, distincte de celle des Réglages admin). `lastSync` reflète la date de la dernière entrée `ReadingList` synchronisée avec succès (`null` si aucune), même principe que `lastSync` sur `GET /api/users/calibre`.
```bash
curl https://app.ndd.fr/api/users/hardcover \
  -H "Authorization: Bearer <token>"
```

### `PUT /api/users/hardcover`
Renvoie `lastSync` au même titre que `GET /api/users/hardcover`.
```bash
curl -X PUT https://app.ndd.fr/api/users/hardcover \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "apiKey": "hc_..."}'
```

### `POST /api/users/hardcover/test`
```bash
curl -X POST https://app.ndd.fr/api/users/hardcover/test \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"apiKey": "hc_..."}'
```

### `POST /api/users/hardcover/sync-now`
Lance en arrière-plan une resynchronisation de tous les livres ajoutés/modifiés depuis la dernière tentative (retente aussi ceux en erreur).
```bash
curl -X POST https://app.ndd.fr/api/users/hardcover/sync-now \
  -H "Authorization: Bearer <token>"
```

### `POST /api/users/hardcover/import`
Importe la bibliothèque Hardcover existante — n'ajoute que les livres absents côté EbookRequest.
```bash
curl -X POST https://app.ndd.fr/api/users/hardcover/import \
  -H "Authorization: Bearer <token>"
```

---

## Apprise

### `GET /api/apprise/config`
```bash
curl https://app.ndd.fr/api/apprise/config \
  -H "Authorization: Bearer <token>"
```

### `PUT /api/apprise/config`
```bash
curl -X PUT https://app.ndd.fr/api/apprise/config \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"urls": ["pover://user@token"], "events": {"completed": true, "canceled": true}}'
```

### `POST /api/apprise/test`
```bash
curl -X POST https://app.ndd.fr/api/apprise/test \
  -H "Authorization: Bearer <token>"
```

---

## MCP

### `GET /api/mcp/info`
```bash
curl https://app.ndd.fr/api/mcp/info \
  -H "Authorization: Bearer <token>"
```

---

## Administration

> Toutes les routes ci-dessous nécessitent un compte avec le rôle `admin`.

### `GET /api/admin/stats`
```bash
curl https://app.ndd.fr/api/admin/stats \
  -H "Authorization: Bearer <token>"
```

### `GET /api/admin/health`
```bash
curl https://app.ndd.fr/api/admin/health \
  -H "Authorization: Bearer <token>"
```

### `GET /api/admin/download-logs`
Filtrable par `connector` (`valentine`, `annasarchive`, `fourtoutici`), `success` (`true`/`false`) et `searchMode` (`detailed`, `direct-valentine`, `direct-fourtoutici`, `admin-manual`) — ce dernier distingue le chemin de recherche ayant mené au téléchargement, indépendamment de `triggeredBy`.
```bash
curl "https://app.ndd.fr/api/admin/download-logs?page=1&limit=50&searchMode=direct-valentine" \
  -H "Authorization: Bearer <token>"
```

### `GET /api/requests/all`
```bash
curl https://app.ndd.fr/api/requests/all \
  -H "Authorization: Bearer <token>"
```

### `PATCH /api/requests/:id/status`
```bash
curl -X PATCH https://app.ndd.fr/api/requests/ID/status \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"status": "completed", "adminComment": "Voici votre livre !"}'
```

### `PATCH /api/requests/:id/comment`
```bash
curl -X PATCH https://app.ndd.fr/api/requests/ID/comment \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"adminComment": "En cours de traitement"}'
```

### `PATCH /api/requests/:id/download-link`

Uploader un fichier :
```bash
curl -X PATCH https://app.ndd.fr/api/requests/ID/download-link \
  -H "Authorization: Bearer <token>" \
  -F "file=@/chemin/vers/livre.epub"
```

Ajouter un lien externe :
```bash
curl -X PATCH https://app.ndd.fr/api/requests/ID/download-link \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"downloadLink": "https://exemple.fr/livre.epub"}'
```

### `GET /api/admin/users` — Liste des utilisateurs
```bash
curl https://app.ndd.fr/api/admin/users \
  -H "Authorization: Bearer <token>"
```

### `POST /api/admin/users` — Créer un utilisateur
```bash
curl -X POST https://app.ndd.fr/api/admin/users \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"username": "bob", "password": "pass", "email": "bob@exemple.fr", "role": "user"}'
```

### `PUT /api/admin/users/:id` — Modifier un utilisateur
`valentineDirectLimit`/`valentineDirectLimitDays` limitent la consommation de cet utilisateur sur le compte Valentine admin partagé (recherche directe), sans effet s'il a son propre compte Valentine. `emailSendLimit`/`emailSendLimitDays` limitent le nombre d'envois de livre par email (voir `POST /api/requests/:id/send-email`), jamais appliqué aux admins. `-1` = illimité dans les deux cas.
```bash
curl -X PUT https://app.ndd.fr/api/admin/users/ID \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"role": "admin", "requestLimit": 10, "requestLimitDays": 30, "valentineDirectLimit": 5, "valentineDirectLimitDays": 7, "emailSendLimit": 10, "emailSendLimitDays": 7}'
```

### `PATCH /api/admin/users/:id/toggle-active`
```bash
curl -X PATCH https://app.ndd.fr/api/admin/users/ID/toggle-active \
  -H "Authorization: Bearer <token>"
```

### `DELETE /api/admin/users/:id`
```bash
curl -X DELETE https://app.ndd.fr/api/admin/users/ID \
  -H "Authorization: Bearer <token>"
```

### `GET /api/admin/logs/system`
```bash
curl https://app.ndd.fr/api/admin/logs/system \
  -H "Authorization: Bearer <token>"
```

### `GET /api/admin/email-logs`
```bash
curl https://app.ndd.fr/api/admin/email-logs \
  -H "Authorization: Bearer <token>"
```

---

## Invitations

### `GET /api/invitations`
```bash
curl https://app.ndd.fr/api/invitations \
  -H "Authorization: Bearer <token>"
```

### `POST /api/invitations`
```bash
curl -X POST https://app.ndd.fr/api/invitations \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"email": "nouvel@utilisateur.fr"}'
```

### `GET /api/invitation-codes`
```bash
curl https://app.ndd.fr/api/invitation-codes \
  -H "Authorization: Bearer <token>"
```

### `POST /api/invitation-codes`
```bash
curl -X POST https://app.ndd.fr/api/invitation-codes \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"maxUses": 5, "expiresInDays": 7}'
```

---

## Connecteurs (admin)

### `GET /api/connectors/valentine`
```bash
curl https://app.ndd.fr/api/connectors/valentine \
  -H "Authorization: Bearer <token>"
```

### `PUT /api/connectors/valentine`
```bash
curl -X PUT https://app.ndd.fr/api/connectors/valentine \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "username": "user", "password": "pass"}'
```

### `GET /api/connectors/valentine/search?q=Dune`
```bash
curl "https://app.ndd.fr/api/connectors/valentine/search?q=Dune" \
  -H "Authorization: Bearer <token>"
```

### `GET /api/connectors/annasarchive/search?q=Dune`
```bash
curl "https://app.ndd.fr/api/connectors/annasarchive/search?q=Dune" \
  -H "Authorization: Bearer <token>"
```

### `GET /api/connectors/fourtoutici`
```bash
curl https://app.ndd.fr/api/connectors/fourtoutici \
  -H "Authorization: Bearer <token>"
```

### `PUT /api/connectors/fourtoutici`
```bash
curl -X PUT https://app.ndd.fr/api/connectors/fourtoutici \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "url": "https://fourtoutici.cc"}'
```

### `GET /api/connectors/fourtoutici/search?q=Dune`
```bash
curl "https://app.ndd.fr/api/connectors/fourtoutici/search?q=Dune" \
  -H "Authorization: Bearer <token>"
```

### `GET /api/connectors/fourtoutici/ping`
```bash
curl https://app.ndd.fr/api/connectors/fourtoutici/ping \
  -H "Authorization: Bearer <token>"
```

### `POST /api/connectors/fourtoutici/download`
Déclenchement manuel depuis les résultats de recherche.
```bash
curl -X POST https://app.ndd.fr/api/connectors/fourtoutici/download \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"fileId": "12345", "requestId": "ID"}'
```

### `GET /api/connectors/predb`
```bash
curl https://app.ndd.fr/api/connectors/predb \
  -H "Authorization: Bearer <token>"
```

### `PUT /api/connectors/predb`
```bash
curl -X PUT https://app.ndd.fr/api/connectors/predb \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "url": "https://api.predb.fr", "apiKey": "ma-cle-api"}'
```

### `POST /api/connectors/predb/test`
```bash
curl -X POST https://app.ndd.fr/api/connectors/predb/test \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"apiKey": "ma-cle-api", "url": "https://api.predb.fr"}'
```

---

## Réglages (admin)

Config transverse (Google Books, Hardcover, IA, Email, RSS, Proxy sortant) — DB en priorité, repli sur `.env` avec migration automatique au premier `GET` si la variable correspondante existe déjà (sauf Hardcover, qui n'a pas de variable `.env` : désactivé par défaut, config uniquement en DB).

### `GET /api/connectors/googlebooks`
```bash
curl https://app.ndd.fr/api/connectors/googlebooks \
  -H "Authorization: Bearer <token>"
```

### `PUT /api/connectors/googlebooks`
```bash
curl -X PUT https://app.ndd.fr/api/connectors/googlebooks \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "apiKey": "AIzaSy..."}'
```

### `POST /api/connectors/googlebooks/test`
```bash
curl -X POST https://app.ndd.fr/api/connectors/googlebooks/test \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"apiKey": "AIzaSy..."}'
```

### `GET /api/connectors/hardcover`
```bash
curl https://app.ndd.fr/api/connectors/hardcover \
  -H "Authorization: Bearer <token>"
```

### `PUT /api/connectors/hardcover`
```bash
curl -X PUT https://app.ndd.fr/api/connectors/hardcover \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "apiKey": "hc_..."}'
```

### `POST /api/connectors/hardcover/test`
```bash
curl -X POST https://app.ndd.fr/api/connectors/hardcover/test \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"apiKey": "hc_..."}'
```

### `GET /api/connectors/aiprovider`
```bash
curl https://app.ndd.fr/api/connectors/aiprovider \
  -H "Authorization: Bearer <token>"
```

### `PUT /api/connectors/aiprovider`
```bash
curl -X PUT https://app.ndd.fr/api/connectors/aiprovider \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "provider": "openai", "model": "gpt-4o-mini", "apiKey": "sk-..."}'
```

### `POST /api/connectors/aiprovider/test`
```bash
curl -X POST https://app.ndd.fr/api/connectors/aiprovider/test \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"provider": "openai", "model": "gpt-4o-mini", "apiKey": "sk-..."}'
```

### `GET /api/connectors/emailprovider`
```bash
curl https://app.ndd.fr/api/connectors/emailprovider \
  -H "Authorization: Bearer <token>"
```

### `PUT /api/connectors/emailprovider`
```bash
curl -X PUT https://app.ndd.fr/api/connectors/emailprovider \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "provider": "smtp", "smtpHost": "smtp.gmail.com", "smtpPort": 465, "smtpSecure": true, "username": "user@gmail.com", "apiKey": "mot-de-passe-smtp", "fromAddress": "noreply@ndd.fr", "fromName": "EbookRequest"}'
```

### `POST /api/connectors/emailprovider/test`
```bash
curl -X POST https://app.ndd.fr/api/connectors/emailprovider/test \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"provider": "smtp", "smtpHost": "smtp.gmail.com", "smtpPort": 465, "smtpSecure": true, "username": "user@gmail.com", "apiKey": "mot-de-passe-smtp", "fromAddress": "noreply@ndd.fr", "fromName": "EbookRequest", "to": "test@example.com"}'
```

### `GET /api/connectors/rss`
```bash
curl https://app.ndd.fr/api/connectors/rss \
  -H "Authorization: Bearer <token>"
```

### `PUT /api/connectors/rss`
```bash
curl -X PUT https://app.ndd.fr/api/connectors/rss \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "url": "https://predb.me/?cats=books-ebooks&rss=1"}'
```

### `GET /api/connectors/apns`
Configuration du push natif iOS (APNs). `mode` vaut `direct` (clé Apple propre à l'instance) ou `relay` (délègue l'envoi à un relais externe qui détient la vraie clé).
```bash
curl https://app.ndd.fr/api/connectors/apns \
  -H "Authorization: Bearer <token>"
```

### `PUT /api/connectors/apns`
Mode direct :
```bash
curl -X PUT https://app.ndd.fr/api/connectors/apns \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "mode": "direct", "apiKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----", "keyId": "ABC123DEFG", "teamId": "AB12CD34EF", "bundleId": "com.ebookrequest.ios.full", "production": true}'
```
Mode relais :
```bash
curl -X PUT https://app.ndd.fr/api/connectors/apns \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "mode": "relay", "relayUrl": "https://push-relay.mondomaine.fr", "relayToken": "jeton-fourni-par-le-relais"}'
```

### `GET /api/connectors/proxy`
```bash
curl https://app.ndd.fr/api/connectors/proxy \
  -H "Authorization: Bearer <token>"
```

### `PUT /api/connectors/proxy`
```bash
curl -X PUT https://app.ndd.fr/api/connectors/proxy \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "url": "http://mon-proxy.example.com:8080", "mode": "fallback", "username": "", "password": ""}'
```

### `POST /api/connectors/proxy/test`
```bash
curl -X POST https://app.ndd.fr/api/connectors/proxy/test \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"url": "http://mon-proxy.example.com:8080", "username": "", "password": ""}'
```

---

## Légal

Routes publiques (pas d'authentification requise), servent le contenu brut de `PRIVACY.md`/`TERMS.md` (racine du repo), lu à chaque requête.

### `GET /api/legal/privacy`
```bash
curl https://app.ndd.fr/api/legal/privacy
```

### `GET /api/legal/terms`
```bash
curl https://app.ndd.fr/api/legal/terms
```

---

## OPDS

Le catalogue OPDS est accessible via le token d'accès intégré dans l'URL :

```
GET /api/opds/:token
GET /api/opds/:token/search?q=Dune
```

Compatible avec KOReader, Calibre, Kybook et toute application supportant OPDS 1.2.
