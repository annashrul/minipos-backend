# syntax=docker/dockerfile:1.6

# ---------- Stage 1: build ----------
FROM node:20-slim AS builder

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/usr/local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.5.2 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile --ignore-scripts || pnpm install --ignore-scripts

COPY . .

RUN pnpm prisma generate \
  && pnpm build

# ---------- Stage 2: runtime ----------
FROM node:20-slim AS runtime

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nestjs

ENV NODE_ENV=production
ENV PORT=8080

WORKDIR /app

COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./

USER nestjs

EXPOSE 8080
CMD ["node", "dist/main.js"]
