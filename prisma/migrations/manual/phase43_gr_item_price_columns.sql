-- phase43: Tambah kolom unitPrice + previousPurchasePrice di goods_receipt_items.
-- Tujuan: simpan snapshot harga PO (new) + harga master sebelum sync (old)
-- supaya detail receiving bisa tampilkan perubahan harga beli.
ALTER TABLE goods_receipt_items
  ADD COLUMN IF NOT EXISTS "unitPrice" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "previousPurchasePrice" DOUBLE PRECISION;
