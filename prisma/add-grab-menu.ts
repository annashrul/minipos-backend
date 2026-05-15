/**
 * One-off script: tambah menu "Integrasi GrabFood" ke AppMenu + permissions.
 * Idempoten — aman dijalankan berkali-kali. Jalankan via:
 *   npx tsx prisma/add-grab-menu.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MENU_KEY = "integrations-grab";
const MENU_NAME = "Integrasi GrabFood";
const MENU_PATH = "/integrations/grab";
const MENU_GROUP = "Integrasi";
const MENU_SORT = 2;

const ACTIONS = [
  { key: "view", name: "Lihat" },
  { key: "sync", name: "Sync Manual" },
  { key: "manage", name: "Tambah/Hapus Akun" },
];

// Role yang boleh akses. Sengaja tidak include CASHIER & MANAGER —
// integrasi marketplace tier admin only.
const ALLOWED_ROLES = ["PLATFORM_OWNER", "SUPER_ADMIN", "ADMIN"];
const ALL_ROLES = [
  "PLATFORM_OWNER",
  "SUPER_ADMIN",
  "ADMIN",
  "MANAGER",
  "CASHIER",
];

async function main() {
  // 1. Upsert AppMenu
  const menu = await prisma.appMenu.upsert({
    where: { key: MENU_KEY },
    create: {
      key: MENU_KEY,
      name: MENU_NAME,
      path: MENU_PATH,
      group: MENU_GROUP,
      sortOrder: MENU_SORT,
      isActive: true,
    },
    update: {
      name: MENU_NAME,
      path: MENU_PATH,
      group: MENU_GROUP,
      sortOrder: MENU_SORT,
      isActive: true,
    },
  });
  console.log(`✓ Menu "${MENU_NAME}" (id=${menu.id}) ready`);

  // 2. Upsert MenuAction per action
  for (let i = 0; i < ACTIONS.length; i++) {
    const action = ACTIONS[i];
    if (!action) continue;
    await prisma.menuAction.upsert({
      where: {
        menuId_key: { menuId: menu.id, key: action.key },
      },
      create: {
        menuId: menu.id,
        key: action.key,
        name: action.name,
        sortOrder: i + 1,
        isActive: true,
      },
      update: {
        name: action.name,
        sortOrder: i + 1,
        isActive: true,
      },
    });
    console.log(`  ✓ Action "${action.key}" ready`);
  }

  // 3. Upsert RoleMenuPermission untuk semua role
  for (const role of ALL_ROLES) {
    await prisma.roleMenuPermission.upsert({
      where: { role_menuId: { role, menuId: menu.id } },
      create: {
        role,
        menuId: menu.id,
        allowed: ALLOWED_ROLES.includes(role),
      },
      update: {
        allowed: ALLOWED_ROLES.includes(role),
      },
    });
  }
  console.log(`  ✓ RoleMenuPermission set untuk ${ALL_ROLES.length} role`);

  // 4. Upsert RoleActionPermission untuk semua role × action
  const actions = await prisma.menuAction.findMany({
    where: { menuId: menu.id },
  });
  for (const a of actions) {
    for (const role of ALL_ROLES) {
      await prisma.roleActionPermission.upsert({
        where: {
          role_menuActionId: { role, menuActionId: a.id },
        },
        create: {
          role,
          menuActionId: a.id,
          allowed: ALLOWED_ROLES.includes(role),
        },
        update: {
          allowed: ALLOWED_ROLES.includes(role),
        },
      });
    }
  }
  console.log(
    `  ✓ RoleActionPermission set untuk ${actions.length} action × ${ALL_ROLES.length} role`,
  );

  console.log("\nSelesai. Refresh browser & user harus re-login (atau clear cache) untuk lihat menu.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
