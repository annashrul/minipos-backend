/**
 * Clean rebalance: distribusi produk Ahhas ke rak yang sesuai kategori,
 * pakai parsing nama rak yang strict.
 *
 * Konvensi nama rak: "Rak {Kategori}" atau "Rak {Kategori} — {Sub}".
 * Script parse nama → group rak by kategori, lalu round-robin produk.
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function parseRackCategory(rackName: string): string | null {
  // "Rak Aki" → "Aki"
  // "Rak Aki — Motor Bebek/Matic" → "Aki"
  // "Rak Kampas Rem — Tromol" → "Kampas Rem"
  // "Rak Filter — Filter Oli Motor" → "Filter"
  const m = rackName.match(/^Rak\s+(.+?)(?:\s+—\s+|\s*$)/);
  return m ? m[1]!.trim() : null;
}

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

  const racks = await prisma.rack.findMany({
    where: { companyId: ahhas.id, branchId: branch.id, isActive: true },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });

  // Group rak by kategori dari parsing name.
  const racksByCat = new Map<string, { id: string; code: string }[]>();
  for (const r of racks) {
    const cat = parseRackCategory(r.name);
    if (!cat) continue;
    const arr = racksByCat.get(cat) ?? [];
    arr.push({ id: r.id, code: r.code });
    racksByCat.set(cat, arr);
  }

  console.log("Rak per kategori:");
  for (const [cat, arr] of racksByCat) {
    console.log(`  ${cat}: ${arr.length} (${arr.map((a) => a.code).join(", ")})`);
  }

  // Untuk setiap produk, cari rak yang kategorinya match, distribusi round-robin.
  const products = await prisma.product.findMany({
    where: { companyId: ahhas.id, deletedAt: null },
    select: {
      id: true,
      code: true,
      category: { select: { name: true } },
      branchStocks: {
        where: { branchId: branch.id },
        select: { quantity: true },
      },
    },
  });

  let reassigned = 0;
  let unchanged = 0;
  let noRack = 0;
  let stockMoved = 0;

  for (const p of products) {
    const catName = p.category?.name;
    if (!catName) continue;
    const targetRacks = racksByCat.get(catName);
    if (!targetRacks || targetRacks.length === 0) {
      noRack++;
      console.warn(`  ⚠️ ${p.code}: kategori "${catName}" tidak punya rak`);
      continue;
    }
    const target = targetRacks[hashStr(p.id) % targetRacks.length]!;

    // Skip kalau sudah di rak yang benar.
    const current = await prisma.product.findUnique({
      where: { id: p.id },
      select: { defaultRackId: true },
    });
    if (current?.defaultRackId === target.id) {
      // Pastikan RackStock juga di tempat yang benar.
      const stock = p.branchStocks[0]?.quantity ?? 0;
      const existingRackStocks = await prisma.rackStock.findMany({
        where: { productId: p.id, branchId: branch.id },
        select: { rackId: true, qty: true },
      });
      const correctlyPlaced =
        existingRackStocks.length === (stock > 0 ? 1 : 0) &&
        (stock === 0 ||
          (existingRackStocks[0]?.rackId === target.id &&
            existingRackStocks[0]?.qty === stock));
      if (correctlyPlaced) {
        unchanged++;
        continue;
      }
    }

    // Reassign.
    await prisma.product.update({
      where: { id: p.id },
      data: { defaultRackId: target.id },
    });
    reassigned++;

    // Rebuild RackStock: hapus di rak lain, set di rak target.
    const stock = p.branchStocks[0]?.quantity ?? 0;
    await prisma.rackStock.deleteMany({
      where: {
        productId: p.id,
        branchId: branch.id,
        rackId: { not: target.id },
      },
    });
    if (stock > 0) {
      await prisma.rackStock.upsert({
        where: {
          rackId_productId: { rackId: target.id, productId: p.id },
        },
        update: { qty: stock },
        create: {
          rackId: target.id,
          productId: p.id,
          branchId: branch.id,
          qty: stock,
        },
      });
      await prisma.rackStockMovement.create({
        data: {
          productId: p.id,
          branchId: branch.id,
          toRackId: target.id,
          qty: stock,
          type: "REBALANCE",
          refType: "seed_rebalance",
          notes: `Clean rebalance ke ${target.code}`,
        },
      });
      stockMoved++;
    } else {
      // qty 0 → pastikan tidak ada RackStock sama sekali
      await prisma.rackStock.deleteMany({
        where: { productId: p.id, branchId: branch.id },
      });
    }
  }

  console.log(`\nReassigned: ${reassigned}`);
  console.log(`Unchanged : ${unchanged}`);
  console.log(`No rack   : ${noRack}`);
  console.log(`Stock moved: ${stockMoved}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
