# Imagem base do Playwright: ja traz Node 20, Chromium e as dependencias de
# sistema necessarias, o que permite o auto-fetch de resultados (best-effort).
FROM mcr.microsoft.com/playwright:v1.49.1-jammy

WORKDIR /app

# Instalar dependencias (inclui better-sqlite3, compilado com as build tools da imagem)
COPY package*.json ./
RUN npm install --omit=dev

# Codigo
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
# A base de dados SQLite vive aqui; monta um volume persistente neste caminho.
ENV DATA_DIR=/app/data

EXPOSE 3000
VOLUME ["/app/data"]

CMD ["node", "server/index.js"]
