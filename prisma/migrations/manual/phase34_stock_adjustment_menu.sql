-- Phase 34: Tambah menu "Adjustment Stok" sebagai entry baru di app_menus.
-- Pisahkan dari Manajemen Stok supaya UX adjustment lebih clear (manajemen
-- stok = list/audit, adjustment = create flow). Idempotent via NOT EXISTS.

INSERT INTO app_menus (id, key, name, path, "group", "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'stock-adjustment', 'Adjustment Stok', '/stock-adjustment', 'Inventori', 5, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM app_menus WHERE key = 'stock-adjustment');

-- Tambah action: view + create.
INSERT INTO menu_actions (id, "menuId", key, name, "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), m.id, 'view', 'View', 1, true, NOW(), NOW()
FROM app_menus m
WHERE m.key = 'stock-adjustment'
  AND NOT EXISTS (
    SELECT 1 FROM menu_actions ma WHERE ma."menuId" = m.id AND ma.key = 'view'
  );

INSERT INTO menu_actions (id, "menuId", key, name, "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), m.id, 'create', 'Create', 2, true, NOW(), NOW()
FROM app_menus m
WHERE m.key = 'stock-adjustment'
  AND NOT EXISTS (
    SELECT 1 FROM menu_actions ma WHERE ma."menuId" = m.id AND ma.key = 'create'
  );

-- Grant menu access ke role: SUPER_ADMIN, ADMIN, MANAGER. Cashier tidak.
INSERT INTO role_menu_permissions (id, role, "menuId", allowed, "createdAt", "updatedAt")
SELECT gen_random_uuid(), r.role, m.id, true, NOW(), NOW()
FROM (VALUES ('SUPER_ADMIN'), ('ADMIN'), ('MANAGER')) AS r(role)
CROSS JOIN app_menus m
WHERE m.key = 'stock-adjustment'
  AND NOT EXISTS (
    SELECT 1 FROM role_menu_permissions rmp
    WHERE rmp.role = r.role AND rmp."menuId" = m.id
  );

-- Grant action access (view+create) ke role: SUPER_ADMIN, ADMIN, MANAGER.
INSERT INTO role_action_permissions (id, role, "menuActionId", allowed, "createdAt", "updatedAt")
SELECT gen_random_uuid(), r.role, ma.id, true, NOW(), NOW()
FROM (VALUES ('SUPER_ADMIN'), ('ADMIN'), ('MANAGER')) AS r(role)
CROSS JOIN menu_actions ma
JOIN app_menus m ON m.id = ma."menuId"
WHERE m.key = 'stock-adjustment'
  AND NOT EXISTS (
    SELECT 1 FROM role_action_permissions rap
    WHERE rap.role = r.role AND rap."menuActionId" = ma.id
  );
