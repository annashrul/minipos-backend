-- ============================================================
-- Auto-generate product code via database trigger
-- Format: {COMPANY_SLUG}-{SEQUENTIAL_NUMBER}
-- Example: TOKO-0001, MYSHOP-0002
-- ============================================================

-- Function: generate product code from company slug + sequence
CREATE OR REPLACE FUNCTION generate_product_code()
RETURNS TRIGGER AS $$
DECLARE
  v_company_slug TEXT;
  v_prefix TEXT;
  v_last_seq INT;
  v_new_code TEXT;
  v_attempt INT := 0;
BEGIN
  -- Skip if code is already provided
  IF NEW.code IS NOT NULL AND NEW.code != '' THEN
    RETURN NEW;
  END IF;

  -- Get company slug
  SELECT UPPER(REGEXP_REPLACE(slug, '[^a-zA-Z0-9]', '', 'g'))
  INTO v_company_slug
  FROM companies
  WHERE id = NEW."companyId";

  -- Fallback if no slug
  IF v_company_slug IS NULL OR v_company_slug = '' THEN
    v_company_slug := 'PRD';
  END IF;

  -- Truncate to max 6 chars
  v_company_slug := LEFT(v_company_slug, 6);
  v_prefix := v_company_slug || '-';

  -- Find last sequence for this company prefix
  LOOP
    SELECT COALESCE(
      MAX(
        NULLIF(
          REGEXP_REPLACE(code, '^' || v_prefix, ''),
          ''
        )::INT
      ),
      0
    )
    INTO v_last_seq
    FROM products
    WHERE "companyId" = NEW."companyId"
      AND code LIKE v_prefix || '%'
      AND REGEXP_REPLACE(code, '^' || v_prefix, '') ~ '^\d+$';

    v_new_code := v_prefix || LPAD((v_last_seq + 1 + v_attempt)::TEXT, 4, '0');

    -- Check uniqueness (handle race condition)
    IF NOT EXISTS (
      SELECT 1 FROM products WHERE "companyId" = NEW."companyId" AND code = v_new_code
    ) THEN
      NEW.code := v_new_code;
      RETURN NEW;
    END IF;

    v_attempt := v_attempt + 1;
    IF v_attempt > 100 THEN
      RAISE EXCEPTION 'Failed to generate unique product code after 100 attempts';
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Trigger: fire before INSERT on products
DROP TRIGGER IF EXISTS trg_generate_product_code ON products;
CREATE TRIGGER trg_generate_product_code
  BEFORE INSERT ON products
  FOR EACH ROW
  EXECUTE FUNCTION generate_product_code();
