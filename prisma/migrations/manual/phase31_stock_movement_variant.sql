-- Phase 31: Tambah variantId + variantLabel di stock_movements supaya kartu
-- stok bisa tampilkan pergerakan per variant (Putih · S, Hitam · L, dll).
-- Backfill tidak dilakukan untuk row lama — kolom NULL = movement product-
-- level (produk tanpa variant atau row legacy sebelum migrasi ini).

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS "variantId"    TEXT,
  ADD COLUMN IF NOT EXISTS "variantLabel" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'stock_movements_variantId_fkey'
  ) THEN
    ALTER TABLE stock_movements
      ADD CONSTRAINT "stock_movements_variantId_fkey"
      FOREIGN KEY ("variantId")
      REFERENCES product_variants(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "stock_movements_variantId_idx"
  ON stock_movements ("variantId");

CREATE INDEX IF NOT EXISTS "stock_movements_productId_variantId_createdAt_idx"
  ON stock_movements ("productId", "variantId", "createdAt");
