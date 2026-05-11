-- phase47_pos_save_draft_action.sql
-- Tambah action "save_draft" di menu "pos" supaya tombol Draft di POS bisa
-- di-control terpisah. Mirror permission dari "create" — kalau role bisa
-- create POS, default bisa save draft (sysadmin bisa restrict di UI).

WITH pos_menu AS (
  SELECT id FROM public.app_menus WHERE key = 'pos'
)
INSERT INTO public.menu_actions (id, "menuId", key, name, "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  pm.id,
  'save_draft',
  'SAVE_DRAFT',
  20,
  TRUE,
  now(),
  now()
FROM pos_menu pm
WHERE NOT EXISTS (
  SELECT 1 FROM public.menu_actions ma
  WHERE ma."menuId" = pm.id AND ma.key = 'save_draft'
);

-- Mirror permission "create" -> "save_draft" untuk tiap role yang punya create.
INSERT INTO public.role_action_permissions (id, role, "menuActionId", allowed, "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  rap.role,
  ma_new.id,
  rap.allowed,
  now(),
  now()
FROM public.menu_actions ma_create
JOIN public.app_menus m ON m.id = ma_create."menuId" AND m.key = 'pos'
JOIN public.role_action_permissions rap ON rap."menuActionId" = ma_create.id
JOIN public.menu_actions ma_new ON ma_new."menuId" = ma_create."menuId"
  AND ma_new.key = 'save_draft'
WHERE ma_create.key = 'create'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_action_permissions x
    WHERE x.role = rap.role AND x."menuActionId" = ma_new.id
  );
