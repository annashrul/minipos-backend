/**
 * Khusus Ahhas: expand rak ke total 50, distribusi ulang produk.
 *
 * Strategy:
 *   - 8 kategori utama (Aki, Aksesoris, Ban, Busi, Filter, Kampas Rem,
 *     Lampu, Oli) dibagi: Aksesoris 8 rak, sisanya 6 rak = 8 + 7*6 = 50.
 *   - Existing rak tetap dipertahankan, hanya tambahkan rak baru sampai
 *     target tercapai per kategori.
 *   - Produk per kategori didistribusi round-robin ke set rak di
 *     kategorinya (hash productId → index).
 *   - RackStock di-rebuild: hapus semua entry RackStock existing untuk
 *     produk yang ter-affect, lalu re-create di rak yang baru dengan qty
 *     dari BranchStock. Log movement type=REBALANCE.
 *
 * Idempotent — aman dijalankan ulang.
 *
 * Usage: npx tsx prisma/seed-ahhas-racks-50.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const COMPANY_NAME = "Ahhas";

// Target jumlah rak per kategori. Total harus 50.
const RACK_TARGETS: Record<string, number> = {
  Aki: 6,
  Aksesoris: 8,
  Ban: 6,
  Busi: 6,
  Filter: 6,
  "Kampas Rem": 6,
  Lampu: 6,
  Oli: 6,
};

// Mapping kategori → prefix 2 huruf untuk kode rak.
const PREFIX: Record<string, string> = {
  Aki: "AK",
  Aksesoris: "AS",
  Ban: "BA",
  Busi: "BU",
  Filter: "FI",
  "Kampas Rem": "KA",
  Lampu: "LA",
  Oli: "OL",
};

// Sub-naming untuk variasi rak per kategori (untuk readability di UI).
// Index ke-N pakai SUB_NAMES[N % length].
const SUB_NAMES: Record<string, string[]> = {
  Aki: ["Motor Bebek/Matic", "Motor Sport/Big", "Aki Kering MF", "Mobil Standar", "Mobil Premium", "Cadangan"],
  Aksesoris: ["Helm", "Jas Hujan & Sarung Tangan", "Body & Spakbor", "Spion & Kunci", "Karpet & Stiker", "Klakson & Elektrik", "Touring & Bag", "Lainnya"],
  Ban: ["Ban Matic 14\"", "Ban Sport 17\"", "Ban Premium", "Ban Dalam", "Ban Mobil", "Cadangan"],
  Busi: ["Busi Motor Matic", "Busi Motor Sport", "Busi Iridium", "Busi MotoDX", "Busi Mobil", "Cadangan"],
  Filter: ["Filter Udara Motor", "Filter Oli Motor", "Filter Bensin", "Filter Udara Mobil", "Filter AC Mobil", "Cadangan"],
  "Kampas Rem": ["Depan Matic", "Belakang Matic", "Depan Sport", "Tromol", "Kampas Mobil", "Kopling"],
  Lampu: ["LED Motor Matic", "LED Motor Sport", "Halogen Motor", "Sein & Rem", "HID Mobil", "Cadangan"],
  Oli: ["Matic 0.8L", "Manual/Gear", "Sintetik/Premium", "Final Drive", "Mobil", "Cadangan"],
};

function rackName(category: string, idx: number): string {
  const subs = SUB_NAMES[category] ?? [];
  const sub = subs[idx] ?? `Slot ${idx + 1}`;
  return `${category} — ${sub}`;
}

// Deterministic hash: productId → integer (untuk round-robin distribusi).
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

async function main() {
  const ahhas = await prisma.company.findFirst({
    where: { name: { contains: COMPANY_NAME, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (!ahhas) {
    console.error("Company not found");
    return;
  }
  const branches = await prisma.branch.findMany({
    where: { companyId: ahhas.id, isActive: true },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
  if (branches.length === 0) {
    console.error("No active branches");
    return;
  }

  console.log(`=== ${ahhas.name}: Expand to 50 racks ===\n`);

  const totalTarget = Object.values(RACK_TARGETS).reduce((a, b) => a + b, 0);
  console.log(`Target: ${totalTarget} racks across ${Object.keys(RACK_TARGETS).length} categories\n`);

  let totalCreated = 0;
  let totalProductsReassigned = 0;
  let totalRackStockReset = 0;

  for (const branch of branches) {
    console.log(`\n[Branch ${branch.name}]`);

    for (const [categoryName, target] of Object.entries(RACK_TARGETS)) {
      const category = await prisma.category.findFirst({
        where: { companyId: ahhas.id, name: categoryName },
        select: { id: true },
      });
      if (!category) {
        console.warn(`  ⚠️  category "${categoryName}" not found — skip`);
        continue;
      }

      // Existing rak untuk kategori ini di branch ini. Pakai pattern name
      // match "Rak {categoryName}" ATAU "{categoryName} —..." (format baru).
      // Plus existing prefix match.
      const prefix = PREFIX[categoryName]!;
      const existingRacks = await prisma.rack.findMany({
        where: {
          companyId: ahhas.id,
          branchId: branch.id,
          OR: [
            { name: { contains: categoryName, mode: "insensitive" } },
            { code: { startsWith: prefix } },
          ],
        },
        select: { id: true, code: true, name: true },
        orderBy: { code: "asc" },
      });

      // Build set of codes that already used (untuk skip saat create baru).
      const usedCodes = new Set(existingRacks.map((r) => r.code));
      const racksForCategory: { id: string; code: string }[] = existingRacks.map(
        (r) => ({ id: r.id, code: r.code }),
      );

      // Buat rak baru kalau belum mencapai target.
      let nextIdx = 1;
      while (racksForCategory.length < target) {
        // Cari kode baru yang belum dipakai.
        let code: string;
        do {
          code = `${prefix}-${String(nextIdx).padStart(2, "0")}`;
          nextIdx++;
        } while (usedCodes.has(code));
        usedCodes.add(code);

        const created = await prisma.rack.create({
          data: {
            branchId: branch.id,
            companyId: ahhas.id,
            code,
            name: `Rak ${rackName(categoryName, racksForCategory.length)}`,
            location: `Section ${prefix}`,
            isActive: true,
          },
          select: { id: true, code: true },
        });
        racksForCategory.push(created);
        totalCreated++;
        console.log(`  + ${code} (${rackName(categoryName, racksForCategory.length - 1)})`);
      }

      // Sort rak by code (stable distribution).
      racksForCategory.sort((a, b) => a.code.localeCompare(b.code));

      // Distribusi produk kategori ini ke rak-rak di kategori ini (round-robin
      // via hash productId untuk deterministic).
      const products = await prisma.product.findMany({
        where: {
          companyId: ahhas.id,
          categoryId: category.id,
          deletedAt: null,
        },
        select: {
          id: true,
          code: true,
          branchStocks: {
            where: { branchId: branch.id },
            select: { quantity: true },
          },
        },
      });

      // Hanya proses di branch pertama (defaultRackId per produk = single).
      const isPrimaryBranch = branch.id === branches[0]?.id;

      for (const p of products) {
        const idx = hashStr(p.id) % racksForCategory.length;
        const targetRack = racksForCategory[idx]!;

        if (isPrimaryBranch) {
          // Update defaultRackId kalau berbeda dari target.
          await prisma.product.update({
            where: { id: p.id },
            data: { defaultRackId: targetRack.id },
          });
          totalProductsReassigned++;
        }

        // Reset RackStock: hapus entries di rak lain (untuk produk+branch ini),
        // create di rak baru dengan qty dari BranchStock.
        const stock = p.branchStocks[0]?.quantity ?? 0;

        // Hapus rack stock di rak lain (selain target).
        await prisma.rackStock.deleteMany({
          where: {
            productId: p.id,
            branchId: branch.id,
            rackId: { not: targetRack.id },
          },
        });

        if (stock > 0) {
          // Upsert di target rack.
          await prisma.rackStock.upsert({
            where: {
              rackId_productId: {
                rackId: targetRack.id,
                productId: p.id,
              },
            },
            update: { qty: stock },
            create: {
              rackId: targetRack.id,
              productId: p.id,
              branchId: branch.id,
              qty: stock,
            },
          });
          await prisma.rackStockMovement.create({
            data: {
              productId: p.id,
              branchId: branch.id,
              toRackId: targetRack.id,
              qty: stock,
              type: "REBALANCE",
              refType: "seed_50_racks",
              notes: `Redistribusi ke ${targetRack.code}`,
            },
          });
          totalRackStockReset++;
        } else {
          // Bila qty 0, pastikan tidak ada RackStock di target juga.
          await prisma.rackStock.deleteMany({
            where: {
              productId: p.id,
              branchId: branch.id,
            },
          });
        }
      }
    }
  }

  // Verify final count.
  const finalCount = await prisma.rack.count({ where: { companyId: ahhas.id } });

  console.log("\n=== Summary ===");
  console.log(`Racks created    : ${totalCreated}`);
  console.log(`Final rack count : ${finalCount}`);
  console.log(`Products moved   : ${totalProductsReassigned}`);
  console.log(`RackStock entries: ${totalRackStockReset}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
