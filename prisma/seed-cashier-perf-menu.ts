import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
    const existing = await prisma.appMenu.findUnique({ where: { key: "cashier-performance" } });
    if (existing) { console.log("Menu already exists"); return; }

    const menu = await prisma.appMenu.create({
        data: {
            key: "cashier-performance",
            name: "Performa Kasir",
            path: "/cashier-performance",
            group: "Laporan",
            sortOrder: 42,
            actions: { create: [
                { key: "view", name: "Lihat", sortOrder: 0 },
            ] },
        },
    });

    await prisma.roleMenuPermission.create({ data: { role: "SUPER_ADMIN", menuId: menu.id, allowed: true } });
    const actions = await prisma.menuAction.findMany({ where: { menuId: menu.id } });
    for (const action of actions) {
        await prisma.roleActionPermission.create({ data: { role: "SUPER_ADMIN", menuActionId: action.id, allowed: true } });
    }
    console.log("Menu 'cashier-performance' created");
}

main().catch(console.error).finally(() => prisma.$disconnect());
