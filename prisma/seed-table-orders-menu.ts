import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MENU = {
  key: "table-orders",
  name: "Order Meja",
  path: "/table-orders",
  group: "Utama",
  sortOrder: 8,
  actions: ["view", "approve", "reject", "update", "pay", "close_session"],
};

// Roles that should have full access to the menu by default.
const ROLES_WITH_FULL_ACCESS = ["SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER"];

async function main() {
  console.log("Seeding table-orders menu...");
  const menu = await prisma.appMenu.upsert({
    where: { key: MENU.key },
    update: {
      name: MENU.name,
      path: MENU.path,
      group: MENU.group,
      sortOrder: MENU.sortOrder,
      isActive: true,
    },
    create: {
      key: MENU.key,
      name: MENU.name,
      path: MENU.path,
      group: MENU.group,
      sortOrder: MENU.sortOrder,
      isActive: true,
    },
  });

  for (const [idx, actionKey] of MENU.actions.entries()) {
    await prisma.menuAction.upsert({
      where: { menuId_key: { menuId: menu.id, key: actionKey } },
      update: { name: actionKey, sortOrder: idx, isActive: true },
      create: {
        menuId: menu.id,
        key: actionKey,
        name: actionKey,
        sortOrder: idx,
        isActive: true,
      },
    });
  }

  for (const role of ROLES_WITH_FULL_ACCESS) {
    await prisma.roleMenuPermission.upsert({
      where: { role_menuId: { role, menuId: menu.id } },
      update: { allowed: true },
      create: { role, menuId: menu.id, allowed: true },
    });
    const actions = await prisma.menuAction.findMany({
      where: { menuId: menu.id },
      select: { id: true },
    });
    for (const a of actions) {
      await prisma.roleActionPermission.upsert({
        where: { role_menuActionId: { role, menuActionId: a.id } },
        update: { allowed: true },
        create: { role, menuActionId: a.id, allowed: true },
      });
    }
  }

  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
