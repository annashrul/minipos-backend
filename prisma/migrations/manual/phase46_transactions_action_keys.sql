-- phase46_transactions_action_keys.sql
-- Tambah 3 action baru di menu "transactions": duplicate, edit, send_whatsapp.
-- Default permission: mirror dari action "view" — kalau role bisa view
-- transaksi, bisa juga duplicate / edit / send WA (sysadmin tinggal restrict
-- per-role di UI Access Control kalau perlu).

WITH tx_menu AS (
  SELECT id FROM public.app_menus WHERE key = 'transactions'
),
new_actions AS (
  SELECT
    tm.id AS menu_id,
    a.key AS action_key,
    a.name AS action_name,
    a.sort_order AS sort
  FROM tx_menu tm
  CROSS JOIN (VALUES
    ('duplicate', 'DUPLICATE', 10),
    ('edit', 'EDIT', 11),
    ('send_whatsapp', 'SEND_WHATSAPP', 12)
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

-- Mirror permission "view" -> "duplicate" / "edit" / "send_whatsapp" untuk
-- tiap role yang sudah punya view. Default: allowed=TRUE supaya behavior
-- existing tidak berubah; sysadmin bisa toggle off di UI Access Control.
INSERT INTO public.role_action_permissions (id, role, "menuActionId", allowed, "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  rap.role,
  ma_new.id,
  rap.allowed,
  now(),
  now()
FROM public.menu_actions ma_view
JOIN public.app_menus m ON m.id = ma_view."menuId" AND m.key = 'transactions'
JOIN public.role_action_permissions rap ON rap."menuActionId" = ma_view.id
JOIN public.menu_actions ma_new ON ma_new."menuId" = ma_view."menuId"
  AND ma_new.key IN ('duplicate', 'edit', 'send_whatsapp')
WHERE ma_view.key = 'view'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_action_permissions x
    WHERE x.role = rap.role AND x."menuActionId" = ma_new.id
  );
