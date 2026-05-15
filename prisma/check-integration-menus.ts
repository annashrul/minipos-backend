import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const menus = await prisma.appMenu.findMany({
    where: {
      OR: [
        { key: { contains: "shopee" } },
        { key: { contains: "grab" } },
        { key: { contains: "integrat" } },
        { path: { contains: "integrations" } },
        { group: { contains: "ntegra" } },
      ],
    },
    orderBy: [{ group: "asc" }, { sortOrder: "asc" }],
  });
  console.log("Found", menus.length, "menus:");
  for (const m of menus) {
    console.log(`  - key=${m.key} | path=${m.path} | group=${m.group} | subgroup=${m.subgroup ?? "-"} | sort=${m.sortOrder}`);
  }
  const groups = await prisma.appMenu.findMany({
    select: { group: true },
    distinct: ["group"],
  });
  console.log("\nAll distinct groups:", groups.map((g) => g.group).join(", "));
}
main().finally(() => prisma.$disconnect());
