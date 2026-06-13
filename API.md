# EbookRequest — Référence API

Toutes les routes sont préfixées par `/api`. L'authentification se fait via le header `Authorization: Bearer <token>`.

Deux types de tokens sont acceptés :

- **JWT** — obtenu via `/api/auth/login`. Expire après un certain délai.
- **Token OPDS** — token personnel stable (sans expiration), visible dans **Paramètres → OPDS** de l'application. Utilisable comme Bearer sur toutes les routes authentifiées. Pratique pour les intégrations externes (scripts, raccourcis, applications tierces).

```bash
curl https://app.ebookrequest.fr/api/requests/quota \
  -H "Authorization: Bearer <opds-token>"
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
```bash
curl -X PUT https://app.ndd.fr/api/reading/ID \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"status": "read", "rating": 5, "notes": "Excellent !", "readingProgress": 100}'
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
```bash
curl -X POST https://app.ndd.fr/api/users/calibre/sync \
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
```bash
curl -X PUT https://app.ndd.fr/api/admin/users/ID \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"role": "admin", "requestLimit": 10, "requestLimitDays": 30}'
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

---

## OPDS

Le catalogue OPDS est accessible sans authentification JWT via le token OPDS :

```
GET /api/opds/:opdsToken
GET /api/opds/:opdsToken/search?q=Dune
```

Compatible avec KOReader, Calibre, Kybook et toute application supportant OPDS 1.2.
