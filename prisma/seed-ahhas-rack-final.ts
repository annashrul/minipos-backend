import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const ahhas = await prisma.company.findFirst({
    where: { name: { contains: "Ahhas", mode: "insensitive" } },
    select: { id: true },
  });
  if (!ahhas) return;
  const branch = await prisma.branch.findFirst({
    where: { companyId: ahhas.id, isActive: true },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (!branch) return;

  // Tambah 1 Aki rack lagi (AK-07).
  const existing = await prisma.rack.findUnique({
    where: { branchId_code: { branchId: branch.id, code: "AK-07" } },
    select: { id: true },
  });
  if (existing) {
    console.log("AK-07 already exists");
  } else {
    await prisma.rack.create({
      data: {
        branchId: branch.id,
        companyId: ahhas.id,
        code: "AK-07",
        name: "Rak Aki — Motor Sport/Big",
        location: "Section AK",
        isActive: true,
      },
    });
    console.log("Created AK-07");
  }

  const total = await prisma.rack.count({ where: { companyId: ahhas.id } });
  console.log(`Total racks: ${total}`);
}
main().finally(() => prisma.$disconnect());
