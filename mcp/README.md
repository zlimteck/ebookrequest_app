# EbookRequest MCP Server

Serveur MCP pour [EbookRequest](https://github.com/zlimteck/ebookrequest_app) — gérez vos demandes de livres depuis n'importe quel client compatible MCP.

## Déploiement sur VPS (recommandé)

### Variables d'environnement (`.env`)

```env
MCP_PORT=3035   # Optionnel, défaut: 3035

# OAuth 2.1 (optionnel — connecteur personnalisé Claude web/iOS/Desktop).
# Les 5 variables sont requises ensemble ; si l'une manque, l'OAuth est
# simplement désactivé (seul le Bearer statique fonctionne).
MCP_URL=https://mcp.ndd.fr
MONGODB_URI=mongodb://mongo:27017/ebookrequest
MCP_OAUTH_JWT_SECRET=     # openssl rand -hex 32
MCP_LOGIN_TICKET_SECRET=  # openssl rand -hex 32
MCP_INTERNAL_SERVICE_SECRET=  # openssl rand -hex 32, partagé avec le backend
```

### Lancement

```bash
docker compose up -d ebookrequest-mcp
```

### Nginx (proxy HTTPS)

Ajoutez dans votre config nginx pour exposer via HTTPS :

```nginx
location /mcp {
    proxy_pass http://localhost:3035/mcp;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_set_header Host $host;
    proxy_buffering off;
}
```

## Configuration Claude

### Claude (Desktop / Mobile) — connecteur personnalisé OAuth

Claude ne permet pas d'envoyer un header `Authorization` personnalisé sur un connecteur, donc l'authentification passe par OAuth 2.1 (spec MCP Authorization) plutôt que par le token Bearer statique. Nécessite d'avoir configuré `MCP_URL`, `MONGODB_URI`, `MCP_OAUTH_JWT_SECRET`, `MCP_LOGIN_TICKET_SECRET` et `MCP_INTERNAL_SERVICE_SECRET` (voir `.env.example`) — sans ces variables, seul le Bearer statique (ci-dessous) fonctionne.

1. Paramètres → Connecteurs → Ajouter un connecteur personnalisé
2. **URL** : `https://mcp.ndd.fr/mcp`
3. Se connecter → vous êtes redirigé vers la page de login EbookRequest (comptes déjà connectés passent directement à l'écran de consentement)
4. Si Claude demande un mode OAuth, choisir **« S'enregistrer automatiquement »** (enregistrement dynamique de client, RFC 7591 — les modes « identité publiée de Claude » et « client OAuth personnalisé » ne sont pas pris en charge)

Détails techniques du flux OAuth (découverte, PKCE, rotation des refresh tokens…) : voir [`API.md`](../API.md#mcp).

### OpenWebUI / ChatMCP (header Bearer statique)

1. Ajouter un serveur → type **SSE / Streamable HTTP**
2. **URL** : `https://mcp.ndd.fr/mcp`
3. **Header** : `Authorization: Bearer <votre token>`

### Claude Desktop — config manuelle (legacy, stdio, local)

```json
{
  "mcpServers": {
    "ebookrequest": {
      "command": "node",
      "args": ["/chemin/vers/ebookrequest/mcp/src/index.js"],
      "env": {
        "EBOOKREQUEST_URL": "https://ndd.fr",
        "EBOOKREQUEST_TOKEN": "votre-token"
      }
    }
  }
}
```

## Outils disponibles

### Utilisateurs
| Outil | Description |
|---|---|
| `search_books` | Rechercher un livre via Google Books avant de soumettre |
| `create_request` | Soumettre une nouvelle demande (couverture et métadonnées auto) |
| `get_my_requests` | Lister mes demandes (filtre par statut optionnel) |
| `get_request_details` | Détails d'une demande par titre : description, couverture, commentaire admin |
| `cancel_request` | Annuler une de ses demandes en attente par titre |
| `check_availability` | Vérifier si un livre est disponible (PreDB, Valentine, Anna's Archive) |
| `direct_search` | Recherche directe et immédiate sur Valentine.wtf (titre, auteur ou série) |
| `direct_search_books` | Lister les livres d'une fiche auteur ou série trouvée par `direct_search` |
| `direct_download` | Télécharger immédiatement un résultat de recherche directe et créer la demande |
| `get_my_shelves` | Lister mes étagères Calibre-Web configurées (pour `direct_download`) |
| `get_my_stats` | Quota utilisé, demandes complétées, en attente |
| `get_my_library` | Ma bibliothèque de lecture avec progression et notes |
| `update_reading_progress` | Mettre à jour statut/note/progression d'un livre de ma bibliothèque |
| `add_to_library` | Ajouter manuellement un livre à ma bibliothèque |
| `remove_from_library` | Retirer un livre de ma bibliothèque |
| `search_authors` | Rechercher un auteur sur Open Library |
| `follow_author` / `unfollow_author` | Suivre / ne plus suivre un auteur |
| `get_my_followed_authors` | Lister les auteurs que je suis |
| `get_upcoming_releases` | Prochaines sorties de livres (BnF, Hardcover) |
| `prowlarr_search` | Recherche via les indexeurs torrent Prowlarr (si configuré) |
| `get_notifications` | Mes notifications non lues, ou historique 7 jours |
| `mark_notification_seen` | Marquer une notification comme lue |
| `search_my_content` | Rechercher dans mes demandes et ma bibliothèque |
| `get_my_profile` | Mes informations de compte de base |
| `get_my_achievements` | Mes succès/badges et ma série d'activité |
| `get_trending_releases` | Livres tendance du mois, par catégorie |
| `get_recommendations` / `regenerate_recommendations` | Recommandations de lecture par IA (régénération limitée à 3/7j) |

### Administrateurs
| Outil | Description |
|---|---|
| `get_pending_requests` | Toutes les demandes en attente |
| `get_all_requests` | Toutes les demandes (filtre par statut) |
| `get_admin_stats` | Statistiques globales de l'application |
| `update_request_status` | Compléter ou annuler une demande |
| `get_user_list` | Lister les utilisateurs avec quota, rôle et dernière activité |
| `get_services_health` | État en temps réel des services (IA, MCP, Apprise, Calibre-Web, Valentine, Anna's Archive) |

## Exemples d'utilisation

> "Cherche le livre Dune de Frank Herbert"

> "Est-ce que Le Nom de la Rose est disponible ?"

> "Ajoute une demande pour Cookie Jar de Stephen King en EPUB"

> "Quelles sont mes demandes en attente ?"

> "Annule ma demande abc123"

> "Montre-moi les stats de ma bibliothèque"

> "Cherche directement sur Valentine le tome 3 de Dune"

> "Liste les livres de la série trouvée à l'url /serie/dune"

> "Télécharge directement le livre avec l'id 12345"

> "Quelles sont mes étagères Calibre-Web ?"

> "Télécharge ce livre et mets-le dans mon étagère Fantasy"

> "Marque Dune comme lu avec une note de 5"

> "Cherche l'auteur Brandon Sanderson et suis-le"

> "Quelles sont les prochaines sorties en BD ?"

> "Cherche Dune sur Prowlarr"

> "J'ai des notifications non lues ?"

> "Quels sont mes succès débloqués ?"

> "Quelles sont les tendances du mois en fantasy ?"

> "Recommande-moi des livres à lire"

> "Combien de demandes sont en attente ?" *(admin)*

> "Liste les utilisateurs" *(admin)*

> "Marque la demande abc123 comme complétée" *(admin)*