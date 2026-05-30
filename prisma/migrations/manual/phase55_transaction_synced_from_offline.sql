-- phase55_transaction_synced_from_offline.sql
-- Penanda transaksi yang dibuat saat offline lalu disinkronkan, supaya bisa
-- ditandai di riwayat (badge "Offline") agar staf memverifikasi promo/poin/
-- customer yang mungkin tidak terhitung saat offline.
-- Schema change additive — backward compatible (default false).

BEGIN;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS "syncedFromOffline" BOOLEAN NOT NULL DEFAULT false;

COMMIT;
