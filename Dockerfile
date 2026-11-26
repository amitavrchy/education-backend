# syntax=docker/dockerfile:1
# Production image for the ShikkhaAI API. Build: docker build -t shikkhaai-api .
# Migration image (prisma CLI + migrations): docker build --target migrate -t shikkhaai-migrate .

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# postinstall runs "prisma generate", which needs the schema and a (dummy) DATABASE_URL.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm ci

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate && npm run build && npm prune --omit=dev

# One-off release step: docker run --rm --env-file .env <image> (runs prisma migrate deploy).
FROM node:24-alpine AS migrate
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json prisma.config.ts ./
COPY prisma ./prisma
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app && mkdir -p /app/storage && chown app:app /app/storage
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/package.json ./package.json
COPY --from=build --chown=app:app /app/prisma ./prisma
USER app
EXPOSE 4000
# Migrations run as a separate release step (the "migrate" target), not at boot.
CMD ["node", "dist/main.js"]
