-- phase21_tx_item_promo_tags.sql
-- Tag asal promo per item: GIFT/TEBUS/DISCOUNT_PERCENT/DISCOUNT_AMOUNT/VOUCHER.
-- Dibaca oleh detail modal riwayat untuk render badge.

ALTER TABLE public.transaction_items
  ADD COLUMN IF NOT EXISTS "promoType" TEXT,
  ADD COLUMN IF NOT EXISTS "promoName" TEXT;
