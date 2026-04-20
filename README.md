# EbookRequest

![EbookRequest Logo](https://zupimages.net/up/25/20/wdmb.png)

Application web de gestion de demandes de livres numériques. Les utilisateurs soumettent des demandes, suivent leur statut et téléchargent leurs livres. Les administrateurs gèrent les demandes, les utilisateurs et les notifications.

## Stack

- **Frontend** — React, React Router, Chart.js, Axios
- **Backend** — Node.js, Express, MongoDB (Mongoose), JWT
- **Notifications** — Email (SMTP), Push (VAPID), Apprise
- **IA** — OpenAI / Ollama (recommandations, descriptions)
- **Déploiement** — Docker, GitHub Actions, Docker Hub

## Fonctionnalités

- Soumission et suivi de demandes de livres
- Recherche via Google Books API
- Bibliothèque personnelle avec statut de lecture et notation
- Page Découverte (tendances, bestsellers, recommandations IA)
- Notifications email et push par événement
- Diffusion admin (email HTML + push vers tous les utilisateurs)
- Réinitialisation de mot de passe par email
- Gestion des utilisateurs (rôles, quotas, activation/désactivation)
- Panel admin avec statistiques et logs

## Déploiement Docker

### Prérequis

- Docker et Docker Compose
- Un compte MongoDB Atlas
- Un token Docker Hub (pour le build via GitHub Actions)

### Variables d'environnement

Copie `.env.example` en `.env` et remplis les valeurs :

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `MONGODB_URI` | URI de connexion MongoDB Atlas |
| `JWT_SECRET` | Clé secrète pour les tokens JWT |
| `FRONTEND_URL` | URL publique de l'application |
| `GOOGLE_BOOKS_API_KEY` | Clé API Google Books |
| `EMAIL_PROVIDER` | Fournisseur email : `smtp` (défaut) ou `resend` |
| `SMTP_*` | Configuration serveur email (si `EMAIL_PROVIDER=smtp`) |
| `RESEND_API_KEY` | Clé API Resend (si `EMAIL_PROVIDER=resend`) |
| `RESEND_WEBHOOK_SECRET` | Secret de signature webhook Resend (optionnel, recommandé) |
| `VAPID_PUBLIC_KEY` | Clé publique pour les push notifications |
| `VAPID_PRIVATE_KEY` | Clé privée pour les push notifications |
| `OPENAI_API_KEY` | Clé API OpenAI (si `AI_PROVIDER=openai`) |
| `APPRISE_URL` | URL du service Apprise |
| `UPLOADS_PATH` | Chemin local pour les fichiers uploadés |

Générer les clés VAPID :
```bash
npx web-push generate-vapid-keys
```

### Lancer l'application

```bash
docker-compose up -d
```

L'application est accessible sur le port défini dans `PORT` (défaut : `5001`).

### Créer le compte administrateur

```bash
docker exec -it ebookrequest node src/scripts/initAdmin.js
```

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
│       └── styles/
├── .github/workflows/          # GitHub Actions
├── .env.example
├── docker-compose.yml
└── Dockerfile
```