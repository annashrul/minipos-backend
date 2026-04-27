import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.appMenu.findUnique({ where: { key: "debts" } });
  if (existing) {
    console.log("Menu 'debts' already exists, skipping.");
    return;
  }

  const menu = await prisma.appMenu.create({
    data: {
      key: "debts",
      name: "Hutang Piutang",
      path: "/debts",
      group: "Keuangan",
      sortOrder: 35,
      actions: {
        create: [
          { key: "view", name: "Lihat", sortOrder: 0 },
          { key: "create", name: "Tambah", sortOrder: 1 },
          { key: "update", name: "Edit", sortOrder: 2 },
          { key: "delete", name: "Hapus", sortOrder: 3 },
          { key: "payment", name: "Pembayaran", sortOrder: 4 },
        ],
      },
    },
  });

  await prisma.roleMenuPermission.create({
    data: { role: "SUPER_ADMIN", menuId: menu.id, allowed: true },
  });

  const actions = await prisma.menuAction.findMany({ where: { menuId: menu.id } });
  for (const action of actions) {
    await prisma.roleActionPermission.create({
      data: { role: "SUPER_ADMIN", menuActionId: action.id, allowed: true },
    });
  }

  console.log("Menu 'debts' created with permissions for SUPER_ADMIN");
}

main().catch(console.error).finally(() => prisma.$disconnect());
