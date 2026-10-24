#!/bin/sh

echo "🛠  Build de l'image ebookrequest sans cache..."
docker build --no-cache --pull -t zlimteck/ebookrequest:latest .

echo "🚀  Démarrage du conteneur..."
docker compose --env-file .env.production up -d --force-recreate

echo "✅ Build terminé — http://localhost:5001"