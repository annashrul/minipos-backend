import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const ahhas = await prisma.company.findFirst({
    where: { name: { contains: "Ahhas", mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (!ahhas) return;
  const codes = await prisma.product.findMany({
    where: { companyId: ahhas.id, deletedAt: null },
    select: { code: true, category: { select: { name: true } } },
    orderBy: { code: "asc" },
  });
  console.log("Existing codes per category:");
  const byCat = new Map<string, string[]>();
  for (const c of codes) {
    const k = c.category?.name ?? "-";
    const arr = byCat.get(k) ?? [];
    arr.push(c.code);
    byCat.set(k, arr);
  }
  for (const [cat, list] of byCat) {
    console.log(`  ${cat}: ${list.join(", ")}`);
  }
}
main().finally(() => prisma.$disconnect());
