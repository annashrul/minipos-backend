-- phase24_product_variants.sql
-- ProductVariant — SKU per kombinasi modifier (Hitam+XL, Putih+M, dll).
-- Variant override harga + punya stok sendiri. Lookup di POS: cari variant
-- dimana set optionIds-nya match dengan modifier yang dipilih customer.

CREATE TABLE IF NOT EXISTS public.product_variants (
  id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "productId"             TEXT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  "priceOverride"         DOUBLE PRECISION,
  "purchasePriceOverride" DOUBLE PRECISION,
  stock                   INTEGER NOT NULL DEFAULT 0,
  barcode                 TEXT UNIQUE,
  "isActive"              BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"             TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_product_variants_product
  ON public.product_variants ("productId");

CREATE TABLE IF NOT EXISTS public.product_variant_options (
  "variantId" TEXT NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  "optionId"  TEXT NOT NULL REFERENCES public.modifier_options(id) ON DELETE CASCADE,
  PRIMARY KEY ("variantId", "optionId")
);
CREATE INDEX IF NOT EXISTS idx_product_variant_options_option
  ON public.product_variant_options ("optionId");
