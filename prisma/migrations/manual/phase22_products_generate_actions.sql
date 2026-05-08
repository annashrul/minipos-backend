-- phase22_products_generate_actions.sql
-- Tambah action "generate_code" & "generate_barcode" di menu "products"
-- untuk semua AppMenu existing. Grant default ke role yang sudah punya
-- "update" — logika: kalau bisa update, bisa generate.

-- Tambah action di AppMenu "products" (jika belum ada).
-- Pakai INSERT … ON CONFLICT (menuId, key) DO NOTHING agar idempotent.
WITH product_menu AS (
  SELECT id FROM public.app_menus WHERE key = 'products'
),
new_actions AS (
  SELECT
    pm.id AS menu_id,
    a.key AS action_key,
    a.name AS action_name,
    a.sort_order AS sort
  FROM product_menu pm
  CROSS JOIN (VALUES
    ('generate_code', 'GENERATE_CODE', 6),
    ('generate_barcode', 'GENERATE_BARCODE', 7)
  ) AS a(key, name, sort_order)
)
INSERT INTO public.menu_actions (id, "menuId", key, name, "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  na.menu_id,
  na.action_key,
  na.action_name,
  na.sort,
  TRUE,
  now(),
  now()
FROM new_actions na
WHERE NOT EXISTS (
  SELECT 1 FROM public.menu_actions ma
  WHERE ma."menuId" = na.menu_id AND ma.key = na.action_key
);

-- Mirror permission "update" -> "generate_code" & "generate_barcode" untuk
-- tiap role. Kalau role allowed update, langsung allowed generate.
INSERT INTO public.role_action_permissions (id, role, "menuActionId", allowed, "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  rap.role,
  ma_new.id,
  rap.allowed,
  now(),
  now()
FROM public.menu_actions ma_update
JOIN public.app_menus m ON m.id = ma_update."menuId" AND m.key = 'products'
JOIN public.role_action_permissions rap ON rap."menuActionId" = ma_update.id
JOIN public.menu_actions ma_new ON ma_new."menuId" = ma_update."menuId"
  AND ma_new.key IN ('generate_code', 'generate_barcode')
WHERE ma_update.key = 'update'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_action_permissions x
    WHERE x.role = rap.role AND x."menuActionId" = ma_new.id
  );
