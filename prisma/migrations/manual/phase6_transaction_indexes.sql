-- ============================================================
-- Performance indexes for transactions table
-- ============================================================

-- Main query index: userId (for companyId filter via JOIN) + createdAt (default sort)
CREATE INDEX IF NOT EXISTS idx_transactions_user_created
  ON transactions ("userId", "createdAt" DESC);

-- Branch filter
CREATE INDEX IF NOT EXISTS idx_transactions_branch_created
  ON transactions ("branchId", "createdAt" DESC)
  WHERE "branchId" IS NOT NULL;

-- Status filter
CREATE INDEX IF NOT EXISTS idx_transactions_status
  ON transactions (status, "createdAt" DESC);

-- Invoice search
CREATE INDEX IF NOT EXISTS idx_transactions_invoice
  ON transactions ("invoiceNumber");

-- Date range
CREATE INDEX IF NOT EXISTS idx_transactions_created
  ON transactions ("createdAt" DESC);

-- Payments lookup
CREATE INDEX IF NOT EXISTS idx_payments_transaction
  ON payments ("transactionId");

-- Transaction items lookup
CREATE INDEX IF NOT EXISTS idx_transaction_items_transaction
  ON transaction_items ("transactionId");
