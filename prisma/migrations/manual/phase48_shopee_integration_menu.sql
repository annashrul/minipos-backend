-- Phase 48: Register menu "Integrasi Shopee" di app_menus supaya muncul di
-- sidebar. Group: Integrasi (new group). Idempotent via NOT EXISTS.

INSERT INTO app_menus (id, key, name, path, "group", "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'integrations-shopee', 'Integrasi Shopee', '/integrations/shopee', 'Integrasi', 1, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM app_menus WHERE key = 'integrations-shopee');

-- Actions: view + sync (sync = trigger fetch products).
INSERT INTO menu_actions (id, "menuId", key, name, "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), m.id, 'view', 'View', 1, true, NOW(), NOW()
FROM app_menus m
WHERE m.key = 'integrations-shopee'
  AND NOT EXISTS (SELECT 1 FROM menu_actions ma WHERE ma."menuId" = m.id AND ma.key = 'view');

INSERT INTO menu_actions (id, "menuId", key, name, "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), m.id, 'sync', 'Sync', 2, true, NOW(), NOW()
FROM app_menus m
WHERE m.key = 'integrations-shopee'
  AND NOT EXISTS (SELECT 1 FROM menu_actions ma WHERE ma."menuId" = m.id AND ma.key = 'sync');

-- Grant menu access ke role: SUPER_ADMIN, ADMIN, MANAGER (owner-level).
-- Cashier tidak butuh akses integrasi.
INSERT INTO role_menu_permissions (id, role, "menuId", allowed, "createdAt", "updatedAt")
SELECT gen_random_uuid(), r.role, m.id, true, NOW(), NOW()
FROM (VALUES ('SUPER_ADMIN'), ('ADMIN'), ('MANAGER')) AS r(role)
CROSS JOIN app_menus m
WHERE m.key = 'integrations-shopee'
  AND NOT EXISTS (
    SELECT 1 FROM role_menu_permissions rmp
    WHERE rmp.role = r.role AND rmp."menuId" = m.id
  );

-- Grant action access (view+sync) ke role: SUPER_ADMIN, ADMIN, MANAGER.
INSERT INTO role_action_permissions (id, role, "menuActionId", allowed, "createdAt", "updatedAt")
SELECT gen_random_uuid(), r.role, ma.id, true, NOW(), NOW()
FROM (VALUES ('SUPER_ADMIN'), ('ADMIN'), ('MANAGER')) AS r(role)
CROSS JOIN menu_actions ma
JOIN app_menus m ON m.id = ma."menuId"
WHERE m.key = 'integrations-shopee'
  AND NOT EXISTS (
    SELECT 1 FROM role_action_permissions rap
    WHERE rap.role = r.role AND rap."menuActionId" = ma.id
  );
