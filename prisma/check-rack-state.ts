import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const ahhas = await prisma.company.findFirst({
    where: { name: { contains: "Ahhas", mode: "insensitive" } },
    select: { id: true },
  });
  if (!ahhas) return;

  // Cross-check: produk per kategori vs rak yang di-assign
  const cats = await prisma.category.findMany({
    where: {
      companyId: ahhas.id,
      products: { some: { companyId: ahhas.id, deletedAt: null } },
    },
    select: {
      id: true,
      name: true,
      products: {
        where: { deletedAt: null },
        select: {
          code: true,
          defaultRack: { select: { code: true, name: true } },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  let bad = 0;
  for (const c of cats) {
    const counts = new Map<string, number>();
    let noRack = 0;
    for (const p of c.products) {
      const code = p.defaultRack?.code ?? "(none)";
      counts.set(code, (counts.get(code) ?? 0) + 1);
      if (!p.defaultRack) noRack++;
    }
    console.log(`\n${c.name} (${c.products.length} produk):`);
    for (const [code, n] of [...counts].sort()) {
      const rackInfo = c.products.find((p) => p.defaultRack?.code === code)?.defaultRack;
      const rackName = rackInfo?.name ?? "-";
      const mismatch = rackName && !rackName.toLowerCase().includes(c.name.toLowerCase()) && code !== "(none)";
      if (mismatch) bad += n;
      console.log(
        `  ${code.padEnd(8)} ${rackName.padEnd(45)} : ${n}${mismatch ? "  ⚠️ kategori mismatch" : ""}`,
      );
    }
    if (noRack > 0) console.log(`  ⚠️ ${noRack} produk tanpa rak`);
  }
  const totalRacks = await prisma.rack.count({ where: { companyId: ahhas.id } });
  console.log(`\nTotal racks: ${totalRacks}`);
  console.log(`Products with mismatched rack-category: ${bad}`);
}
main().finally(() => prisma.$disconnect());
