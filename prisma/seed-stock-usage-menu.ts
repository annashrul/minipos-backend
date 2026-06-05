import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Menu untuk fitur Pemakaian Barang (Goods Issue) — pengeluaran stok karena
// dipakai/dikonsumsi internal (mis. sparepart untuk perbaikan mesin).
const MENU = {
  key: "stock-usage",
  name: "Pemakaian Barang",
  path: "/stock-usage",
  group: "Inventori",
  subgroup: "Stock",
  sortOrder: 9,
  actions: [
    { key: "view", name: "Lihat", sortOrder: 0 },
    { key: "create", name: "Catat Pemakaian", sortOrder: 1 },
  ],
};

const ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER"];

async function main() {
  const menu = await prisma.appMenu.upsert({
    where: { key: MENU.key },
    update: {
      name: MENU.name,
      path: MENU.path,
      group: MENU.group,
      subgroup: MENU.subgroup,
      sortOrder: MENU.sortOrder,
      isActive: true,
    },
    create: {
      key: MENU.key,
      name: MENU.name,
      path: MENU.path,
      group: MENU.group,
      subgroup: MENU.subgroup,
      sortOrder: MENU.sortOrder,
      isActive: true,
    },
  });

  for (const a of MENU.actions) {
    await prisma.menuAction.upsert({
      where: { menuId_key: { menuId: menu.id, key: a.key } },
      update: { name: a.name, sortOrder: a.sortOrder, isActive: true },
      create: {
        menuId: menu.id,
        key: a.key,
        name: a.name,
        sortOrder: a.sortOrder,
        isActive: true,
      },
    });
  }

  const actions = await prisma.menuAction.findMany({
    where: { menuId: menu.id },
    select: { id: true },
  });

  for (const role of ROLES) {
    await prisma.roleMenuPermission.upsert({
      where: { role_menuId: { role, menuId: menu.id } },
      update: { allowed: true },
      create: { role, menuId: menu.id, allowed: true },
    });
    for (const action of actions) {
      await prisma.roleActionPermission.upsert({
        where: { role_menuActionId: { role, menuActionId: action.id } },
        update: { allowed: true },
        create: { role, menuActionId: action.id, allowed: true },
      });
    }
  }

  console.log(`Menu '${MENU.key}' siap (akses penuh: ${ROLES.join(", ")}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
