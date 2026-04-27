-- ============================================================
-- Performance indexes for products table (100k+ rows)
-- ============================================================

-- Enable trigram extension for ILIKE search optimization
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Composite index for the most common query pattern
CREATE INDEX IF NOT EXISTS idx_products_company_active
  ON products ("companyId", "isActive")
  WHERE "deletedAt" IS NULL;

-- Index for search (name, code, barcode)
CREATE INDEX IF NOT EXISTS idx_products_name_trgm
  ON products USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_products_code_trgm
  ON products USING gin (code gin_trgm_ops);

-- Index for category/brand/supplier filter
CREATE INDEX IF NOT EXISTS idx_products_category
  ON products ("companyId", "categoryId")
  WHERE "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS idx_products_brand
  ON products ("companyId", "brandId")
  WHERE "deletedAt" IS NULL;

-- Index for stock filter
CREATE INDEX IF NOT EXISTS idx_products_stock
  ON products ("companyId", stock)
  WHERE "deletedAt" IS NULL;

-- Index for sorting by createdAt (default sort)
CREATE INDEX IF NOT EXISTS idx_products_created
  ON products ("companyId", "createdAt" DESC)
  WHERE "deletedAt" IS NULL;

-- Branch stock/price lookup
CREATE INDEX IF NOT EXISTS idx_branch_stocks_lookup
  ON branch_stocks ("productId", "branchId");

CREATE INDEX IF NOT EXISTS idx_branch_prices_lookup
  ON branch_product_prices ("productId", "branchId");

-- Count optimization
CREATE INDEX IF NOT EXISTS idx_products_company_deleted
  ON products ("companyId")
  WHERE "deletedAt" IS NULL;
