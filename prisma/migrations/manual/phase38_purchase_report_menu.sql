-- Phase 38: Tambah menu "Laporan Pembelian" — record semua aktivitas
-- terkait Purchase Order (CREATE, UPDATE status, RECEIVE, CLOSE, CANCEL).
-- Reuse audit_logs entity='PurchaseOrder' yang sudah di-populate via
-- createAuditLog di server actions.

INSERT INTO app_menus (id, key, name, path, "group", subgroup, "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'purchase-report', 'Laporan Pembelian', '/purchase-report', 'Inventori', 'Purchase', 7, true, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM app_menus WHERE key = 'purchase-report');

INSERT INTO menu_actions (id, "menuId", key, name, "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), m.id, 'view', 'View', 1, true, NOW(), NOW()
FROM app_menus m
WHERE m.key = 'purchase-report'
  AND NOT EXISTS (
    SELECT 1 FROM menu_actions ma WHERE ma."menuId" = m.id AND ma.key = 'view'
  );

INSERT INTO menu_actions (id, "menuId", key, name, "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), m.id, 'export', 'Export', 2, true, NOW(), NOW()
FROM app_menus m
WHERE m.key = 'purchase-report'
  AND NOT EXISTS (
    SELECT 1 FROM menu_actions ma WHERE ma."menuId" = m.id AND ma.key = 'export'
  );

-- Grant ke SUPER_ADMIN, ADMIN, MANAGER.
INSERT INTO role_menu_permissions (id, role, "menuId", allowed, "createdAt", "updatedAt")
SELECT gen_random_uuid(), r.role, m.id, true, NOW(), NOW()
FROM (VALUES ('SUPER_ADMIN'), ('ADMIN'), ('MANAGER')) AS r(role)
CROSS JOIN app_menus m
WHERE m.key = 'purchase-report'
  AND NOT EXISTS (
    SELECT 1 FROM role_menu_permissions rmp
    WHERE rmp.role = r.role AND rmp."menuId" = m.id
  );

INSERT INTO role_action_permissions (id, role, "menuActionId", allowed, "createdAt", "updatedAt")
SELECT gen_random_uuid(), r.role, ma.id, true, NOW(), NOW()
FROM (VALUES ('SUPER_ADMIN'), ('ADMIN'), ('MANAGER')) AS r(role)
CROSS JOIN menu_actions ma
JOIN app_menus m ON m.id = ma."menuId"
WHERE m.key = 'purchase-report'
  AND NOT EXISTS (
    SELECT 1 FROM role_action_permissions rap
    WHERE rap.role = r.role AND rap."menuActionId" = ma.id
  );
