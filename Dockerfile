# ── Stage 1 : build React frontend ────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./

# Même origine → VITE_API_URL vide (requêtes relatives /api/...)
ENV VITE_API_URL=""

RUN npm run build

# ── Stage 2 : image finale Node.js ────────────────────────────────────────────
FROM node:20-slim

WORKDIR /app

# Calibre pour ebook-convert (conversion de formats ebook). fontconfig +
# fonts-dejavu-core pour le rendu texte des images Open Graph générées par
# sharp (src/services/ogImageService.js) — sans ça le texte sort en carrés
# vides (tofu), sharp/librsvg n'embarque pas de police par défaut.
RUN apt-get update && \
    apt-get install -y --no-install-recommends calibre wget fontconfig fonts-dejavu-core && \
    rm -rf /var/lib/apt/lists/*

# Dépendances backend uniquement (production)
COPY package*.json ./
RUN npm ci --only=production

# Code backend
COPY src/ ./src/
COPY PRIVACY.md TERMS.md API.md ./

# Build React issu du stage précédent
COPY --from=frontend-builder /app/frontend/build ./frontend/build

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:5001/api/health || exit 1

EXPOSE 5001

CMD ["node", "src/index.js"]