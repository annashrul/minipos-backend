-- Phase 30: Cleanup stale pos.businessMode untuk non-F&B companies.
-- Setting `pos.businessMode='restaurant'` mungkin pernah di-set test, tapi
-- kalau company-nya RETAIL/BENGKEL, harus retail. Update branch yang
-- punya setting `restaurant` tapi parent company-nya bukan RESTAURANT/CAFE.

UPDATE settings s
SET value = 'retail',
    "updatedAt" = NOW()
FROM branches b
JOIN companies c ON b."companyId" = c.id
WHERE s."branchId" = b.id
  AND s.key = 'pos.businessMode'
  AND s.value = 'restaurant'
  AND c.business_unit NOT IN ('RESTAURANT', 'CAFE');
