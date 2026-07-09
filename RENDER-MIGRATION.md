# Panduan Migrasi: Google Cloud Run → Render

## Ringkasan

Backend MiniPOS sebelumnya di-deploy ke **Google Cloud Run** menggunakan `cloudbuild.yaml`.  
Panduan ini menjelaskan cara memindahkannya ke **Render** dengan menggunakan `render.yaml` (Blueprint) yang sudah disiapkan.

---

## Perbedaan Utama Cloud Run vs Render

| Aspek           | Google Cloud Run              | Render                         |
| --------------- | ----------------------------- | ------------------------------ |
| Config deploy   | `cloudbuild.yaml`             | `render.yaml`                  |
| Secrets         | Google Secret Manager         | Render Dashboard / Environment |
| PORT            | Otomatis 8080                 | Otomatis (biasanya 10000)      |
| Docker build    | Cloud Build (remote)          | Render build server            |
| Auto-deploy     | Cloud Build trigger           | Push ke branch `main`          |
| Pre-deploy hook | Tidak ada (manual)            | `preDeployCommand`             |
| Pricing         | Per request + CPU             | Per jam (instance running)     |
| Cold start      | Ada (kecuali min-instances=1) | Ada di free tier               |

> **Catatan PORT:** `src/main.ts` sudah membaca `process.env.PORT` → tidak ada perubahan kode yang diperlukan.

---

## Prasyarat

1. Akun di [render.com](https://render.com)
2. Repo GitHub sudah terhubung ke Render
3. Database PostgreSQL sudah tersedia (Supabase / Neon / Render PostgreSQL)
4. Semua nilai secrets sudah disiapkan (lihat daftar di bawah)

---

## Langkah-langkah Migrasi

### 1. Siapkan Database URL

Database yang digunakan adalah **PostgreSQL** (via Prisma).  
Ada **dua URL** yang dibutuhkan (lihat `prisma/schema.prisma`):

- `DATABASE_URL` → URL **connection pool** (untuk app runtime)
- `DIRECT_URL` → URL **direct** ke database (untuk `prisma migrate deploy`)

**Opsi database yang direkomendasikan:**

| Provider              | Gratis       | Connection Pool         | Keterangan                  |
| --------------------- | ------------ | ----------------------- | --------------------------- |
| **Supabase**          | ✅ (500MB)   | ✅ Built-in (port 6543) | Paling mudah                |
| **Neon**              | ✅ (512MB)   | ✅ Serverless pooler    | Cold start DB               |
| **Render PostgreSQL** | ✅ (90 hari) | ❌ Manual via PgBouncer | Tidak direkomendasikan free |

**Contoh format URL Supabase:**

```
# DATABASE_URL (pooler — port 6543)
postgresql://postgres.[project-ref]:[password]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true

# DIRECT_URL (direct — port 5432)
postgresql://postgres.[project-ref]:[password]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
```

> ⚠️ **PENTING — Penyebab error `ENOTFOUND tenant/user postgres.xxx not found`:**
>
> Error ini terjadi jika `DATABASE_URL` menggunakan format **IPv4 pooler Supabase yang lama**.  
> Pastikan URL sudah menggunakan format baru (ada `.pooler.supabase.com`):
>
> ❌ **SALAH** (format lama — tidak jalan di Render):
>
> ```
> postgresql://postgres:password@db.bdalkozutcaevriltbjh.supabase.co:5432/postgres
> ```
>
> ✅ **BENAR** (format pooler baru):
>
> ```
> # DATABASE_URL — pakai port 6543 + ?pgbouncer=true
> postgresql://postgres.bdalkozutcaevriltbjh:password@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true
>
> # DIRECT_URL — pakai port 5432 tanpa pgbouncer
> postgresql://postgres.bdalkozutcaevriltbjh:password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
> ```
>
> Cara dapatkan URL yang benar: **Supabase Dashboard → Settings → Database → Connection string → Mode: Transaction (pooler)**

---

### 2. Kumpulkan Semua Secrets

Buka **Google Secret Manager** di GCP Console dan catat nilai-nilai berikut:

| Secret Name (GCP)      | Env Key (Render)       | Keterangan                 |
| ---------------------- | ---------------------- | -------------------------- |
| `database-url`         | `DATABASE_URL`         | Connection pool URL        |
| `direct-url`           | `DIRECT_URL`           | Direct URL (untuk migrate) |
| `jwt-secret`           | `JWT_SECRET`           | Secret untuk JWT signing   |
| `cloudinary-url`       | `CLOUDINARY_URL`       | Upload gambar              |
| `resend-api-key`       | `RESEND_API_KEY`       | Email service              |
| `pusher-app-id`        | `PUSHER_APP_ID`        | Realtime events            |
| `pusher-key`           | `PUSHER_KEY`           | Realtime events            |
| `pusher-secret`        | `PUSHER_SECRET`        | Realtime events            |
| `pusher-cluster`       | `PUSHER_CLUSTER`       | Realtime events            |
| `xendit-secret-key`    | `XENDIT_SECRET_KEY`    | Payment gateway            |
| `xendit-webhook-token` | `XENDIT_WEBHOOK_TOKEN` | Webhook verification       |
| `groq-api-key`         | `GROQ_API_KEY`         | AI/LLM                     |
| `redis-url`            | `REDIS_URL`            | Cache / queue              |
| `gemini-api-key`       | `GEMINI_API_KEY`       | Google AI                  |
| `sentry-dsn`           | `SENTRY_DSN`           | Error tracking             |

**Cara ekspor dari GCP Secret Manager:**

```bash
# Jalankan untuk setiap secret
gcloud secrets versions access latest --secret="jwt-secret"
gcloud secrets versions access latest --secret="redis-url"
# dst...
```

---

### 3. Deploy via Render Blueprint

#### Opsi A: Menggunakan render.yaml (Direkomendasikan)

1. Push file `render.yaml` ke repo GitHub
2. Buka [render.com](https://render.com) → **New** → **Blueprint**
3. Pilih repo GitHub yang berisi proyek ini
4. Render akan otomatis mendeteksi `backend/render.yaml`
5. Isi nilai secrets yang `sync: false` saat wizard berjalan
6. Klik **Apply**

#### Opsi B: Manual via Dashboard

1. Buka [render.com](https://render.com) → **New** → **Web Service**
2. Connect repo GitHub
3. Isi konfigurasi:
   - **Name:** `menopos-api`
   - **Runtime:** Docker
   - **Root Directory:** `backend`
   - **Dockerfile Path:** `./Dockerfile`
   - **Branch:** `main`
4. Di tab **Environment**, tambahkan semua env vars dari tabel di atas
5. Di tab **Advanced**, tambahkan **Pre-Deploy Command:**
   ```
   npx prisma migrate deploy
   ```
6. Klik **Create Web Service**

---

### 4. Update Webhook URLs

Setelah service live, Render akan memberikan URL seperti:

```
https://menopos-api.onrender.com
```

Update URL ini di:

- **Xendit Dashboard** → Webhook URL → `https://menopos-api.onrender.com/api/xendit/webhook`
- **Frontend `.env`** → `NEXT_PUBLIC_API_URL=https://menopos-api.onrender.com`
- **WA Service** → Update callback URL jika ada

---

### 5. Verifikasi Deployment

Setelah deploy selesai, cek endpoint berikut:

```bash
# Health check
curl https://menopos-api.onrender.com/api/health

# Swagger docs
open https://menopos-api.onrender.com/api/docs
```

Response health yang diharapkan: **HTTP 200**

---

## Perbandingan Biaya

| Plan Render        | Harga     | RAM   | CPU    | Keterangan                  |
| ------------------ | --------- | ----- | ------ | --------------------------- |
| **Starter (Free)** | $0/bulan  | 512MB | Shared | Sleep setelah 15 menit idle |
| **Starter**        | $7/bulan  | 512MB | Shared | Always-on                   |
| **Standard**       | $25/bulan | 2GB   | 1 vCPU | Production-ready            |

> Cloud Run sebelumnya: `--min-instances=1` + `--no-cpu-throttling` → biaya ~$15-30/bulan tergantung traffic.
>
> Untuk production setara, gunakan **Render Standard ($25/bulan)** atau minimal **Starter ($7/bulan)** agar tidak sleep.

---

## Hal yang Perlu Diperhatikan

### ⚠️ Cold Start (Free Tier)

Render free tier akan "sleep" setelah 15 menit tidak ada request.  
Request pertama bisa memakan waktu **30-60 detik** untuk wake up.  
→ Solusi: Upgrade ke plan berbayar, atau gunakan uptime monitor (UptimeRobot) untuk ping setiap 5 menit.

### ⚠️ Redis

Jika menggunakan Redis untuk session/cache/queue, pastikan `REDIS_URL` mengarah ke provider yang masih aktif (Upstash, Redis Cloud, dll).  
Render juga menyediakan **Redis add-on** berbayar.

### ⚠️ Socket.IO / WebSocket

Render mendukung WebSocket secara native — tidak ada konfigurasi tambahan.  
Pastikan frontend menggunakan URL Render yang baru untuk koneksi Socket.IO.

### ⚠️ Prisma Binary Targets

`schema.prisma` sudah dikonfigurasi:

```prisma
binaryTargets = ["native", "linux-musl-openssl-3.0.x"]
```

`linux-musl-openssl-3.0.x` = Alpine Linux (Dockerfile stage runtime).  
Ini **kompatibel** dengan Render — tidak perlu diubah.

### ⚠️ Docker Build Cache

Cloud Build menggunakan registry cache (`--cache-from registry`).  
Render memiliki build cache tersendiri — build pertama akan lebih lambat (~3-5 menit), selanjutnya lebih cepat.

---

## Rollback Plan

Jika ada masalah di Render, Cloud Run masih bisa diaktifkan kembali:

```bash
# Re-deploy ke Cloud Run dari image terakhir
gcloud run deploy pos-api \
  --image=asia-southeast2-docker.pkg.dev/pos-offline-116b6/pos-api/api:latest \
  --region=asia-southeast2 \
  --platform=managed
```

---

## File yang Ditambahkan

- `backend/render.yaml` — Blueprint konfigurasi Render
- `backend/RENDER-MIGRATION.md` — Panduan ini

File yang **tidak berubah**:

- `backend/Dockerfile` — Kompatibel langsung dengan Render
- `backend/src/main.ts` — Sudah baca `process.env.PORT`
- `backend/prisma/schema.prisma` — Binary targets sudah correct
