# EbookRequest MCP Server

Serveur MCP pour [EbookRequest](https://github.com/zlimteck/ebookrequest_app) — gérez vos demandes de livres depuis n'importe quel client compatible MCP.

## Déploiement sur VPS (recommandé)

### Variables d'environnement (`.env`)

```env
MCP_EBOOKREQUEST_TOKEN=votre-opds-token   # Paramètres → OPDS dans l'app
MCP_AUTH_TOKEN=un-secret-fort              # Protège l'endpoint MCP
MCP_PORT=3035                              # Optionnel, défaut: 3035
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
3. **Header** : `Authorization` → `Bearer <MCP_AUTH_TOKEN>`

### Web (via URL)

Dans Claude.ai → Paramètres → Connecteurs → Ajouter :

- **URL** : `https://mcp.ndd.fr/mcp`
- **Clé API** : valeur de `MCP_AUTH_TOKEN`

> Si `MCP_AUTH_TOKEN` n'est pas défini, l'endpoint est public (déconseillé).

### Claude Desktop (stdio, local)

```json
{
  "mcpServers": {
    "ebookrequest": {
      "command": "node",
      "args": ["/chemin/vers/ebookrequest/mcp/src/index.js"],
      "env": {
        "EBOOKREQUEST_URL": "https://ndd.fr",
        "EBOOKREQUEST_TOKEN": "votre-opds-token"
      }
    }
  }
}
```

## Outils disponibles

### Utilisateurs
| Outil | Description |
|---|---|
| `get_my_requests` | Lister mes demandes (filtre par statut optionnel) |
| `create_request` | Soumettre une nouvelle demande de livre |
| `get_my_stats` | Quota utilisé, demandes complétées, en attente |
| `get_my_library` | Ma bibliothèque de lecture avec progression |

### Administrateurs
| Outil | Description |
|---|---|
| `get_pending_requests` | Toutes les demandes en attente |
| `get_all_requests` | Toutes les demandes (filtre par statut) |
| `get_admin_stats` | Statistiques globales de l'application |
| `update_request_status` | Compléter ou annuler une demande |

## Exemples d'utilisation

> "Quelles sont mes demandes en attente ?"

> "Ajoute une demande pour Le Nom de la Rose d'Umberto Eco en EPUB"

> "Montre-moi les stats de ma bibliothèque"

> "Combien de demandes sont en attente ?" *(admin)*

> "Marque la demande abc123 comme complétée" *(admin)*