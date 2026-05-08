-- phase19_payment_split_detail.sql
-- Tambah kolom `personLabel` ke payments untuk menandai pembayar di Split Bill.
-- NULL = pembayaran biasa (single-payer atau multi-method oleh 1 orang).
-- Diisi saat split bill: "Orang 1", "Orang 2", dst (atau nama jika diinput).
-- Field `reference` sudah ada — di-repurpose untuk simpan info bank/ref code
-- non-tunai.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS "personLabel" TEXT;
