-- Phase 57: Tambah unitId di promotions supaya promo bisa menarget SATUAN
-- spesifik dari sebuah produk (mis. promo hanya untuk satuan "bungkus" pada
-- Sampoerna Mild). null = berlaku untuk semua satuan produk (backward-compat).
-- Hanya relevan saat scope="product" (productId di-set).

ALTER TABLE promotions
  ADD COLUMN IF NOT EXISTS "unitId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'promotions_unitId_fkey'
  ) THEN
    ALTER TABLE promotions
      ADD CONSTRAINT "promotions_unitId_fkey"
      FOREIGN KEY ("unitId")
      REFERENCES product_units(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "promotions_unitId_idx"
  ON promotions ("unitId");
