# syntax=docker/dockerfile:1.7
# Optimized untuk cache reuse — target build time <60s setelah first build.

# ============ Stage 1: builder ============
FROM node:20-slim AS builder

# node:20-slim sudah include openssl 3.x → tidak perlu apt-get install.
# Skip ca-certificates juga; npm/pnpm pakai Node bundled CA.

ENV PNPM_HOME=/usr/local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true

# Corepack pre-installed di node:20+. Activate sekali, cached forever.
RUN corepack enable && corepack prepare pnpm@10.5.2 --activate

WORKDIR /app

# ── Layer 1: deps (BERUBAH SEDIKIT — paling atas untuk max cache reuse)
# pnpm fetch download semua deps ke store tanpa link node_modules.
# Pakai BuildKit cache-mount agar pnpm store persist antar build.
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# ── Layer 2: prisma schema (jarang berubah)
COPY prisma ./prisma
RUN pnpm prisma generate

# ── Layer 3: source (paling sering berubah — taruh paling bawah)
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build


# ============ Stage 2: runtime ============
# Pakai alpine untuk image lebih kecil (push & pull lebih cepat).
# Prisma butuh openssl di alpine.
FROM node:20-alpine AS runtime

RUN apk add --no-cache openssl ca-certificates \
 && addgroup -S -g 1001 nodejs \
 && adduser -S -u 1001 -G nodejs nestjs

ENV NODE_ENV=production
## PORT tidak di-hardcode — Render inject PORT otomatis saat runtime.
## main.ts sudah baca process.env.PORT ?? "4000" (fallback untuk dev lokal).

WORKDIR /app

# Copy hanya yang dibutuhkan runtime — buang devDeps, source, prisma migrations
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/prisma/schema.prisma ./prisma/schema.prisma
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./

USER nestjs
## EXPOSE hanya dokumentasi — Render pakai PORT env var, bukan EXPOSE value.
EXPOSE 10000
CMD ["node", "dist/main.js"]
