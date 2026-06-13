# EbookRequest MCP Server

Serveur MCP pour [EbookRequest](https://github.com/zlimteck/ebookrequest_app) — gérez vos demandes de livres depuis n'importe quel client compatible MCP.

## Déploiement sur VPS (recommandé)

### Variables d'environnement (`.env`)

```env
MCP_PORT=3035   # Optionnel, défaut: 3035
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

### iOS / iPadOS — ChatMCP

L'app Claude iOS ne supporte pas les connecteurs MCP personnalisés. Utilise **[ChatMCP](https://apps.apple.com/fr/app/chatmcp/id6745196560)** à la place :

1. Ajouter un serveur → type **SSE / Streamable HTTP**
2. **URL** : `https://mcp.ndd.fr/mcp`
3. **Clé API** : votre token (visible dans **Paramètres → Token d'accès**)

### Web (Claude.ai, OpenWebUI…)

Paramètres → Connecteurs → Ajouter :

- **URL** : `https://mcp.ndd.fr/mcp`
- **Clé API** : votre token (visible dans **Paramètres → Token d'accès**)

### Claude Desktop (stdio, local)

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
| `get_my_stats` | Quota utilisé, demandes complétées, en attente |
| `get_my_library` | Ma bibliothèque de lecture avec progression et notes |

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

> "Combien de demandes sont en attente ?" *(admin)*

> "Liste les utilisateurs" *(admin)*

> "Marque la demande abc123 comme complétée" *(admin)*