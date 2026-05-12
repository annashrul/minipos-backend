-- Phase 50: Backfill default ProductUnit untuk produk auto-import dari Shopee
-- yang belum punya unit. Tanpa unit, form edit UI tidak bisa nampilkan harga
-- karena UI baca harga dari product_units (bukan Product.sellingPrice).
-- Idempotent: skip produk yang sudah punya unit.

INSERT INTO product_units (id, "productId", name, "conversionQty", "sellingPrice", "purchasePrice", "isDefault", "sortOrder", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  p.id,
  'pcs',
  1,
  p."sellingPrice",
  0,
  true,
  0,
  NOW(),
  NOW()
FROM products p
JOIN categories c ON c.id = p."categoryId"
WHERE c.name = 'Shopee Import'
  AND c.kind = 'PRODUCT'
  AND NOT EXISTS (
    SELECT 1 FROM product_units pu WHERE pu."productId" = p.id
  );
