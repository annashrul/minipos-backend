-- phase54_transaction_idempotency_key.sql
-- Idempotency key untuk checkout — cegah transaksi dobel saat sinkronisasi
-- antrian offline (retry yang membawa key sama tidak akan membuat row baru).
-- Schema changes (semua additive — backward compatible):
--   1. transactions: tambah kolom nullable "idempotencyKey"
--   2. Composite unique (companyId, idempotencyKey). Di PostgreSQL banyak baris
--      dengan NULL pada salah satu kolom dianggap distinct, jadi seluruh
--      transaksi online lama (idempotencyKey = NULL) tidak terpengaruh.
-- Nama index dibuat sama dengan yang di-generate Prisma dari
-- @@unique([companyId, idempotencyKey]) supaya schema & DB tetap in-sync.

BEGIN;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "transactions_companyId_idempotencyKey_key"
  ON public.transactions ("companyId", "idempotencyKey");

COMMIT;
