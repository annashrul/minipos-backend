-- Phase 51: Backfill BranchProductPrice + BranchStock untuk produk Shopee
-- Import yang belum punya data per-cabang. Tab "Harga & Stok" di product edit
-- form baca dari sini, jadi tanpa row di tabel ini value-nya 0 semua.
-- Idempotent: skip pair (branch, product) yang sudah ada.

-- 1) BranchProductPrice — pakai Product.sellingPrice sebagai default.
INSERT INTO branch_product_prices (id, "branchId", "productId", "sellingPrice", "purchasePrice", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  b.id,
  p.id,
  p."sellingPrice",
  0,
  NOW(),
  NOW()
FROM products p
JOIN categories c ON c.id = p."categoryId"
CROSS JOIN branches b
WHERE c.name = 'Shopee Import'
  AND c.kind = 'PRODUCT'
  AND b."companyId" = p."companyId"
  AND b."isActive" = true
  AND NOT EXISTS (
    SELECT 1 FROM branch_product_prices bpp
    WHERE bpp."branchId" = b.id AND bpp."productId" = p.id
  );

-- 2) BranchStock — pakai Product.stock sebagai default.
INSERT INTO branch_stocks (id, "branchId", "productId", quantity, "minStock", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  b.id,
  p.id,
  p.stock,
  5,
  NOW(),
  NOW()
FROM products p
JOIN categories c ON c.id = p."categoryId"
CROSS JOIN branches b
WHERE c.name = 'Shopee Import'
  AND c.kind = 'PRODUCT'
  AND b."companyId" = p."companyId"
  AND b."isActive" = true
  AND NOT EXISTS (
    SELECT 1 FROM branch_stocks bs
    WHERE bs."branchId" = b.id AND bs."productId" = p.id
  );
