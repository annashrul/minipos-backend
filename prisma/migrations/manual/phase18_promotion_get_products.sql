-- phase18_promotion_get_products.sql
-- Multi-reward Tebus Murah: 1 promo bisa menyediakan banyak produk tebus
-- (any-of pilihan). Engine generate 1 option per (promo, getProduct).
-- Backward-compat dengan kolom `getProductId` single — kalau tabel ini kosong,
-- engine fallback ke kolom lama.

CREATE TABLE IF NOT EXISTS public.promotion_get_products (
  "promoId"   TEXT NOT NULL REFERENCES public.promotions(id) ON DELETE CASCADE,
  "productId" TEXT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  PRIMARY KEY ("promoId", "productId")
);

CREATE INDEX IF NOT EXISTS idx_promotion_get_products_product
  ON public.promotion_get_products ("productId");
