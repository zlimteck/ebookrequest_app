# EbookRequest

![EbookRequest Logo](https://zupimages.net/up/25/20/wdmb.png)

[![Docker Hub](https://img.shields.io/docker/v/zlimteck/ebookrequest?label=Docker%20Hub&logo=docker)](https://hub.docker.com/r/zlimteck/ebookrequest)
[![Build](https://github.com/zlimteck/ebookrequest_app/actions/workflows/docker-publish.yml/badge.svg)](https://github.com/zlimteck/ebookrequest_app/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Application web de gestion de demandes de livres numériques. Les utilisateurs soumettent des demandes, suivent leur statut et téléchargent leurs livres. Les administrateurs gèrent les demandes, les utilisateurs et les notifications.

## Stack

- **Frontend** — React, React Router, Chart.js, Axios
- **Backend** — Node.js, Express, MongoDB (Mongoose), JWT
- **Notifications** — Email (SMTP), Push (VAPID), Apprise
- **IA** — OpenAI / Ollama (recommandations, descriptions)
- **Connecteurs** — Valentine (téléchargement auto), Anna's Archive (recherche + téléchargement via FlareSolverr)
- **Déploiement** — Docker, GitHub Actions, Docker Hub

## Fonctionnalités

**Demandes**
- Soumission et suivi de demandes de livres
- Recherche via Google Books API avec auto-complétion des métadonnées
- Vérification de disponibilité à la soumission (flux PreDB)
- Quota de demandes configurable par utilisateur (nombre + fenêtre glissante en jours)
- Soumission admin au nom d'un autre utilisateur

**Téléchargement**
- Téléchargement automatique via Valentine, avec fallback Anna's Archive
- Recherche manuelle sur les connecteurs depuis le panel admin
- Envoi automatique des livres vers Calibre-Web (avec sync étagère Kobo)

**Utilisateurs & accès**
- Inscription par invitation email ou code d'invitation (usage limité, expiration configurable)
- Authentification deux facteurs (2FA — TOTP) avec codes de récupération
- Réinitialisation de mot de passe par email
- Gestion des utilisateurs (rôles, quotas, activation/désactivation)
- Catalogue OPDS pour accès depuis les liseuses (Calibre, KOReader…)

**Notifications**
- Notifications email et push (VAPID) par événement
- Notifications multi-services via Apprise (Pushover, Discord, Telegram, Slack, Gotify, Ntfy…)
  - Côté admin : notifications globales configurables par événement (nouvelle demande, complétion, annulation, commentaire, signalement, nouvel utilisateur)
  - Côté utilisateur : chaque utilisateur peut configurer ses propres URLs Apprise dans ses paramètres pour recevoir ses notifications personnelles (livre disponible, annulation, commentaire admin)
- Diffusion admin (email HTML + push vers tous les utilisateurs)

**Découverte & IA**
- Bibliothèque personnelle avec statut de lecture et notation
- Page Découverte (tendances, bestsellers, recommandations IA)

**Administration**
- Panel admin avec statistiques et logs
- Visionneuse de logs système en temps réel

## Déploiement Docker

### Prérequis

- Docker et Docker Compose
- Une instance MongoDB — [MongoDB Atlas](https://www.mongodb.com/atlas) (cloud, gratuit en tier M0) ou une instance locale

### Image Docker

L'image est disponible publiquement sur Docker Hub :

```
zlimteck/ebookrequest:latest
```

👉 [hub.docker.com/r/zlimteck/ebookrequest](https://hub.docker.com/r/zlimteck/ebookrequest)

### docker-compose.yml

Un `docker-compose.yml` est fourni à la racine du projet. Il inclut le conteneur principal **ebookrequest** ainsi que **FlareSolverr** (nécessaire pour Anna's Archive) :

```yaml
services:
  ebookrequest:
    image: zlimteck/ebookrequest:latest
    container_name: ebookrequest
    restart: always
    ports:
      - "${PORT:-5001}:5001"
    volumes:
      - ${UPLOADS_PATH}:/app/uploads
    environment:
      - NODE_ENV=production
      - MONGODB_URI=${MONGODB_URI}
      - JWT_SECRET=${JWT_SECRET}
      - FRONTEND_URL=${FRONTEND_URL}
      # ... (voir .env.example pour la liste complète)
    extra_hosts:
      - "host.docker.internal:host-gateway"

  flaresolverr:
    image: ghcr.io/flaresolverr/flaresolverr:latest
    container_name: flaresolverr
    restart: unless-stopped
    ports:
      - "8191:8191"
```

> Les variables d'environnement sont lues depuis le fichier `.env` placé au même niveau que `docker-compose.yml`.

> **FlareSolverr** est inclus dans le `docker-compose.yml` et démarré automatiquement. Il est nécessaire pour contourner la protection Cloudflare d'Anna's Archive lors des téléchargements automatiques. Sans lui, le connecteur Anna's Archive ne fonctionnera pas. L'URL est préconfigurée à `http://flaresolverr:8191` — aucune configuration supplémentaire n'est requise si tu utilises le `docker-compose.yml` fourni.

### Variables d'environnement

Copie `.env.example` en `.env` et remplis les valeurs :

```bash
cp .env.example .env
```

#### Général

| Variable | Description |
|---|---|
| `NODE_ENV` | `production` ou `development` |
| `PORT` | Port du backend (défaut : `5001`) |
| `MONGODB_URI` | URI de connexion MongoDB (Atlas ou local) |
| `JWT_SECRET` | Clé secrète pour signer les tokens JWT — choisir une valeur longue et aléatoire |
| `UPLOADS_PATH` | Chemin absolu du dossier de stockage des fichiers uploadés |

#### URLs

| Variable | Description |
|---|---|
| `FRONTEND_URL` | URL publique de l'application (ex : `https://ebook.tondomaine.fr`). Utilisée pour les liens dans les emails (vérification, reset mot de passe, invitations) et la configuration CORS en production. **Obligatoire en production.** |
| `REACT_APP_API_URL` | URL du backend utilisée par le frontend au moment du build (ex : `https://ebook.tondomaine.fr`). Nécessaire uniquement si le frontend et le backend sont sur des origines différentes. En monorepo (frontend servi par le backend), laisser vide — les requêtes sont alors relatives (`/api/...`). |

#### Email

| Variable | Description |
|---|---|
| `EMAIL_PROVIDER` | `smtp` (défaut) ou `resend` |
| `SMTP_HOST` | Adresse du serveur SMTP (ex : `smtp.gmail.com`) |
| `SMTP_PORT` | Port SMTP — `587` pour STARTTLS, `465` pour SSL/TLS |
| `SMTP_SECURE` | `false` avec le port `587` (STARTTLS), `true` avec le port `465` (SSL) — **ne pas mélanger** |
| `SMTP_USER` | Identifiant de connexion SMTP |
| `SMTP_PASSWORD` | Mot de passe SMTP |
| `EMAIL_FROM_ADDRESS` | Adresse expéditrice des emails |
| `EMAIL_FROM_NAME` | Nom affiché dans les emails (ex : `EbookRequest`) |
| `RESEND_API_KEY` | Clé API Resend (si `EMAIL_PROVIDER=resend`) |
| `RESEND_WEBHOOK_SECRET` | Secret de signature webhook Resend (optionnel, recommandé) |

#### Push notifications

| Variable | Description |
|---|---|
| `VAPID_PUBLIC_KEY` | Clé publique VAPID |
| `VAPID_PRIVATE_KEY` | Clé privée VAPID |

Générer les clés VAPID :
```bash
npx web-push generate-vapid-keys
```

#### Intelligence artificielle

| Variable | Description |
|---|---|
| `AI_PROVIDER` | `openai` ou `ollama` |
| `OPENAI_API_KEY` | Clé API OpenAI (si `AI_PROVIDER=openai`) |
| `OPENAI_MODEL` | Modèle OpenAI à utiliser (ex : `gpt-4o-mini`) |
| `OLLAMA_URL` | URL du serveur Ollama (si `AI_PROVIDER=ollama`, ex : `http://172.17.0.x:11434`) |
| `OLLAMA_MODEL` | Nom du modèle Ollama |
| `OLLAMA_TIMEOUT` | Timeout en ms pour les requêtes Ollama (défaut : `60000`) |

#### Connecteurs & services externes

| Variable | Description |
|---|---|
| `GOOGLE_BOOKS_API_KEY` | Clé API Google Books (recherche et métadonnées) |
| `APPRISE_URL` | URL du service Apprise pour les notifications (ex : `http://192.168.1.x:8621`). Ne pas ajouter `/notify` — le chemin est ajouté automatiquement. **Apprise doit être hébergé séparément** — il n'est pas inclus dans le `docker-compose.yml` fourni. Voir [github.com/caronc/apprise-api](https://github.com/caronc/apprise-api). |
| `FLARESOLVERR_URL` | URL du service FlareSolverr pour contourner les protections Cloudflare (défaut : `http://flaresolverr:8191`) |
| `RSS_FEED_URL` | URL du flux RSS (PreDB) utilisé pour vérifier si un livre est récemment sorti et estimer sa disponibilité au moment de la demande (défaut : `https://predb.me/?cats=books-ebooks&rss=1`) |

### Lancer l'application

```bash
docker-compose up -d
```

L'application est accessible sur le port défini dans `PORT` (défaut : `5001`).

### Reverse proxy (HTTPS)

L'application écoute sur le port `5001` en HTTP. Pour l'exposer sur un domaine en HTTPS, place un reverse proxy devant (Nginx Proxy Manager, Traefik, Caddy…) qui redirige le trafic HTTPS vers `localhost:5001`.

Pense à renseigner `FRONTEND_URL` avec ton URL publique pour que les liens dans les emails fonctionnent correctement.

### Créer le compte administrateur

Au premier lancement, ouvre l'application dans ton navigateur — tu seras redirigé automatiquement vers la page `/setup` pour créer le compte administrateur.

### Mise à jour

Pour mettre à jour vers la dernière version :

```bash
docker-compose pull
docker-compose up -d
```

### Accès OPDS

Le catalogue OPDS est accessible à l'adresse suivante (pour connecter une liseuse, Calibre, KOReader…) :

```
http(s)://ton-domaine/opds
```

Le token d'accès personnel est disponible dans les paramètres du compte utilisateur.

## Structure du projet

```
ebookrequest/
├── src/                        # Backend Express
│   ├── controllers/
│   ├── middleware/
│   ├── models/
│   ├── routes/
│   ├── scripts/                # initAdmin, migrations
│   ├── services/               # email, push, IA, trending...
│   └── index.js
├── frontend/                   # React app
│   ├── public/
│   └── src/
│       ├── components/
│       ├── context/
│       ├── hooks/
│       ├── pages/
│       ├── services/
│       ├── styles/
│       └── utils/
├── .env.example
├── docker-compose.yml
└── Dockerfile
```