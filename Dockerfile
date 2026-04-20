# ── Stage 1 : build React frontend ────────────────────────────────────────────
FROM node:18-alpine AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./

# Même origine → REACT_APP_API_URL vide (requêtes relatives /api/...)
ENV REACT_APP_API_URL=""

RUN npm run build

# ── Stage 2 : image finale Node.js ────────────────────────────────────────────
FROM node:18-alpine

WORKDIR /app

# Dépendances backend uniquement (production)
COPY package*.json ./
RUN npm ci --only=production

# Code backend
COPY src/ ./src/

# Build React issu du stage précédent
COPY --from=frontend-builder /app/frontend/build ./frontend/build

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:5001/api/health || exit 1

EXPOSE 5001

CMD ["node", "src/index.js"]