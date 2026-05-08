-- phase44: Tambah kolom previousPurchasePrice di purchase_order_items.
-- Tujuan: snapshot harga master saat PO ini diterima pertama kali, supaya
-- laporan pembelian bisa tampilkan perubahan harga beli per item PO tanpa
-- harus JOIN ke goods receipts.
ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS "previousPurchasePrice" DOUBLE PRECISION;
