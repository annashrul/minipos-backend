-- phase20_split_bill_enum.sql
-- Tambah value SPLIT_BILL ke enum PaymentMethod. Penanda bahwa transaksi
-- pakai Split Bill — bukan metode pembayaran konkret. Detail metode per
-- orang ada di tabel payments (kolom personLabel + method).

-- ALTER TYPE ADD VALUE harus dijalankan di luar transaction block.
-- Postgres 12+ support IF NOT EXISTS untuk idempotency.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'SPLIT_BILL';
