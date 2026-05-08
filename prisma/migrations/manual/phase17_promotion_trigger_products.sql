-- phase17_promotion_trigger_products.sql
-- Multi-trigger Tebus Murah: 1 promo bisa di-trigger oleh banyak produk
-- (ANY-of semantic). Customer beli SALAH SATU produk dari list ini sudah
-- memenuhi syarat. Backward-compat dengan kolom `productId` single-trigger
-- pada tabel promotions — engine fallback ke productId/categoryId kalau
-- promotion_trigger_products kosong untuk promo tertentu.

CREATE TABLE IF NOT EXISTS public.promotion_trigger_products (
  "promoId"   TEXT NOT NULL REFERENCES public.promotions(id) ON DELETE CASCADE,
  "productId" TEXT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  PRIMARY KEY ("promoId", "productId")
);

CREATE INDEX IF NOT EXISTS idx_promotion_trigger_products_product
  ON public.promotion_trigger_products ("productId");
