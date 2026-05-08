-- Phase 33: Tambah unitId + variantId di purchase_order_items supaya PO
-- multi-satuan / multi-varian bisa simpan SKU spesifik. Goods receipt
-- berikutnya pakai info ini untuk decrement stok di SKU yang tepat.

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS "unitId"    TEXT,
  ADD COLUMN IF NOT EXISTS "variantId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'purchase_order_items_unitId_fkey'
  ) THEN
    ALTER TABLE purchase_order_items
      ADD CONSTRAINT "purchase_order_items_unitId_fkey"
      FOREIGN KEY ("unitId")
      REFERENCES product_units(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'purchase_order_items_variantId_fkey'
  ) THEN
    ALTER TABLE purchase_order_items
      ADD CONSTRAINT "purchase_order_items_variantId_fkey"
      FOREIGN KEY ("variantId")
      REFERENCES product_variants(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "purchase_order_items_unitId_idx"
  ON purchase_order_items ("unitId");

CREATE INDEX IF NOT EXISTS "purchase_order_items_variantId_idx"
  ON purchase_order_items ("variantId");
