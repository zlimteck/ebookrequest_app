FROM node:22-slim
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev
COPY src/ src/
CMD ["node", "src/index.js"]