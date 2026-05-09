-- phase45: Tambah enum value DRAFT di TransactionStatus.
-- Postgres tidak izinkan ALTER TYPE ... ADD VALUE di transaksi yang sama
-- dengan operasi DDL lain, jadi run statement ini sendiri.
ALTER TYPE "TransactionStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
