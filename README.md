# menopos-backend

Standalone NestJS backend untuk menopos. Direstrukturisasi dari monorepo `pos-claude` menjadi single-repo agar gampang deploy ke Cloud Run.

## Stack

- NestJS 10 + TypeScript
- Prisma 6 (PostgreSQL / Supabase)
- JWT auth (passport-jwt)
- Redis (ioredis) untuk cache & rate limiting (opsional)
- Cloudinary untuk upload
- Groq SDK untuk AI assistant

## Persiapan

```bash
pnpm install
cp .env.example .env
# isi DATABASE_URL, JWT_SECRET, dst.
pnpm prisma:generate
```

## Development

```bash
pnpm dev          # nodemon + ts-node, hot reload
pnpm typecheck    # tsc --noEmit
pnpm build        # compile ke ./dist
pnpm start        # node dist/main.js
```

## Database

```bash
pnpm prisma:migrate         # dev migration
pnpm prisma:deploy          # production migration
pnpm prisma:studio          # GUI
pnpm db:seed                # seed full
pnpm db:seed:platform-owner # seed platform owner only
```

Manual SQL migrations ada di `prisma/migrations/manual/` (jalankan manual via `psql` atau Supabase SQL editor).

## Deploy ke Cloud Run

```bash
# build image via Cloud Build
gcloud builds submit --config=cloudbuild.yaml \
  --substitutions=_IMAGE=gcr.io/PROJECT_ID/minipos-backend:latest

# deploy
gcloud run deploy minipos-backend \
  --image=gcr.io/PROJECT_ID/minipos-backend:latest \
  --region=asia-southeast2 \
  --allow-unauthenticated \
  --port=8080 \
  --set-env-vars="NODE_ENV=production" \
  --set-secrets="DATABASE_URL=DATABASE_URL:latest,JWT_SECRET=JWT_SECRET:latest"
```

## Struktur

```
src/
  contracts/        # zod DTOs + auth types (eks-@pos/shared)
  common/           # filters, interceptors, pipes
  modules/          # 60+ feature modules
  app.module.ts
  main.ts
prisma/
  schema.prisma
  seed*.ts
  migrations/manual/
```

Path alias: `@/*` -> `src/*`.
