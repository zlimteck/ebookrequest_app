#!/bin/sh

echo "🛠  Build de l'image ebookrequest sans cache (ARM64)..."
DOCKER_DEFAULT_PLATFORM=linux/arm64 docker build --no-cache -t zlimteck/ebookrequest:latest .

echo "🚀  Démarrage du conteneur..."
DOCKER_DEFAULT_PLATFORM=linux/arm64 docker-compose up -d --force-recreate

echo "✅ Build terminé — http://localhost:5001"