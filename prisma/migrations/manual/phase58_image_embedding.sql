-- ============================================================
-- Phase 58: Image embedding untuk Search-by-Image (pgvector)
-- ============================================================
-- Konteks terverifikasi sebelum migrasi ini ditulis:
--   * pgvector 0.8.0 SUDAH terinstal di schema "extensions"
--   * search_path = "$user", public, extensions  → tipe `vector` dan operator
--     `<=>` resolve TANPA qualifier. Tidak perlu CREATE EXTENSION di sini
--     (menghindari kebutuhan privilege pada role pooled).
--   * vw_product_branch (phase4 / phase32) memakai daftar kolom EKSPLISIT,
--     bukan SELECT *, jadi menambah kolom di products TIDAK merusak view.
--     Tidak perlu CREATE OR REPLACE VIEW.
--
-- Dimensi 768 = SigLIP base (google/siglip-base-patch16-224 & siglip2-base,
-- keduanya vision hidden_size 768). Kalau model diganti ke CLIP ViT-B/32
-- (projection_dim 512, terverifikasi dari config.json), kolom ini WAJIB
-- di-recreate. Backend assert VECTOR_DIMENSION == /health.dim saat startup
-- supaya mismatch gagal cepat, bukan menyimpan vektor sampah.

ALTER TABLE products ADD COLUMN IF NOT EXISTS embedding vector(768);

ALTER TABLE products ADD COLUMN IF NOT EXISTS "embeddedAt" timestamptz;

ALTER TABLE products ADD COLUMN IF NOT EXISTS "embeddingModel" text;

ALTER TABLE products ADD COLUMN IF NOT EXISTS "embeddedImageUrl" text;

-- Partial btree index untuk memilih batch backfill (bukan index vektor).
CREATE INDEX IF NOT EXISTS idx_products_embed_pending
  ON products ("companyId")
  WHERE embedding IS NULL AND "imageUrl" IS NOT NULL AND "deletedAt" IS NULL;

-- Partial btree index untuk pre-filter query similarity.
CREATE INDEX IF NOT EXISTS idx_products_embed_ready
  ON products ("companyId")
  WHERE embedding IS NOT NULL AND "deletedAt" IS NULL;


-- SENGAJA TIDAK ADA INDEX ANN (HNSW/IVFFlat) di v1.
-- Alasan berbasis skala terukur: setiap query WAJIB pre-filter companyId, dan
-- katalog per-company terbesar = 181 produk (911 produk total, 76 berfoto).
-- Exact scan atas puluhan vektor = sub-milidetik dengan recall 100%. HNSW &
-- IVFFlat bersifat aproksimatif — menukar recall sempurna dengan kecepatan
-- yang tidak dibutuhkan adalah kerugian bersih.
-- KAPAN PINDAH: saat satu company melewati ~50k baris ber-embedding. Pilih
-- HNSW (bukan IVFFlat) karena pgvector 0.8.0 mendukung hnsw.iterative_scan,
-- yang membuat kombinasi filter + ANN tetap benar:
--   CREATE INDEX CONCURRENTLY idx_products_embedding_hnsw
--     ON products USING hnsw (embedding vector_cosine_ops);
-- Opclass yang tersedia di server ini sudah dikonfirmasi:
--   hnsw/vector_cosine_ops, ivfflat/vector_cosine_ops (+ varian l1/l2/ip/halfvec)

COMMENT ON COLUMN products.embedding IS
  'Vektor gambar (cosine, sudah L2-normalized) dari ai-service. NULL = belum di-embed.';

COMMENT ON COLUMN products."embeddedImageUrl" IS
  'imageUrl yang dipakai saat embedding dibuat. Beda dengan imageUrl = embedding stale.';

