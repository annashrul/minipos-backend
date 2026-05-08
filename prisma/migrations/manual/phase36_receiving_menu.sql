-- Phase 36: Tambah menu "Receiving" sebagai entry baru di app_menus.
-- Pisahkan flow receive PO ke menu sendiri supaya halaman PO tidak overload
-- (PO = create/order/close, Receiving = menerima barang). Idempotent.

INSERT INTO app_menus (id, key, name, path, "group", "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'receiving', 'Receiving', '/receiving', 'Inventori', 6, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM app_menus WHERE key = 'receiving');

-- Actions: view + receive.
INSERT INTO menu_actions (id, "menuId", key, name, "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), m.id, 'view', 'View', 1, true, NOW(), NOW()
FROM app_menus m
WHERE m.key = 'receiving'
  AND NOT EXISTS (
    SELECT 1 FROM menu_actions ma WHERE ma."menuId" = m.id AND ma.key = 'view'
  );

INSERT INTO menu_actions (id, "menuId", key, name, "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), m.id, 'receive', 'Receive', 2, true, NOW(), NOW()
FROM app_menus m
WHERE m.key = 'receiving'
  AND NOT EXISTS (
    SELECT 1 FROM menu_actions ma WHERE ma."menuId" = m.id AND ma.key = 'receive'
  );

-- Grant ke SUPER_ADMIN, ADMIN, MANAGER.
INSERT INTO role_menu_permissions (id, role, "menuId", allowed, "createdAt", "updatedAt")
SELECT gen_random_uuid(), r.role, m.id, true, NOW(), NOW()
FROM (VALUES ('SUPER_ADMIN'), ('ADMIN'), ('MANAGER')) AS r(role)
CROSS JOIN app_menus m
WHERE m.key = 'receiving'
  AND NOT EXISTS (
    SELECT 1 FROM role_menu_permissions rmp
    WHERE rmp.role = r.role AND rmp."menuId" = m.id
  );

INSERT INTO role_action_permissions (id, role, "menuActionId", allowed, "createdAt", "updatedAt")
SELECT gen_random_uuid(), r.role, ma.id, true, NOW(), NOW()
FROM (VALUES ('SUPER_ADMIN'), ('ADMIN'), ('MANAGER')) AS r(role)
CROSS JOIN menu_actions ma
JOIN app_menus m ON m.id = ma."menuId"
WHERE m.key = 'receiving'
  AND NOT EXISTS (
    SELECT 1 FROM role_action_permissions rap
    WHERE rap.role = r.role AND rap."menuActionId" = ma.id
  );
