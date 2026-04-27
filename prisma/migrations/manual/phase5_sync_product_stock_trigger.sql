-- ============================================================
-- Trigger: Sync product.stock from SUM(branch_stocks.quantity)
-- Fires after INSERT/UPDATE/DELETE on branch_stocks
-- Keeps product.stock always = total of all branch quantities
-- ============================================================

CREATE OR REPLACE FUNCTION sync_product_stock_from_branches()
RETURNS TRIGGER AS $$
DECLARE
  v_product_id TEXT;
  v_total INT;
BEGIN
  -- Determine which product to sync
  IF TG_OP = 'DELETE' THEN
    v_product_id := OLD."productId";
  ELSE
    v_product_id := NEW."productId";
  END IF;

  -- Calculate total stock across all branches
  SELECT COALESCE(SUM(quantity), 0)
  INTO v_total
  FROM branch_stocks
  WHERE "productId" = v_product_id;

  -- Update product global stock
  UPDATE products
  SET stock = v_total, "updatedAt" = NOW()
  WHERE id = v_product_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if any
DROP TRIGGER IF EXISTS trg_sync_product_stock ON branch_stocks;

-- Create trigger on branch_stocks table
CREATE TRIGGER trg_sync_product_stock
  AFTER INSERT OR UPDATE OF quantity OR DELETE
  ON branch_stocks
  FOR EACH ROW
  EXECUTE FUNCTION sync_product_stock_from_branches();
