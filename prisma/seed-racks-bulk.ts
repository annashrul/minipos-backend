/**
 * Bulk rack seed + product migration.
 *
 * What it does:
 *   1. Untuk setiap company yang punya branch aktif, generate racks per
 *      cabang — 1 rak per kategori produk yang dipakai di company itu.
 *      Kode rak: `<2 huruf kategori>-<NN>` (mis. OL-01, BU-01).
 *      Kalau total kategori > 50, dipakai bucket "MISC" untuk sisanya.
 *   2. Untuk produk yang belum punya defaultRackId, assign ke rak yang
 *      sesuai dengan kategorinya (di branch primary = branch pertama dari
 *      company), atau ke rak "MISC" kalau kategori tidak ke-map.
 *   3. Bila produk punya BranchStock > 0 di branch yang sama, juga buat
 *      RackStock + RackStockMovement (type MIGRATION) — supaya data
 *      konsisten dari awal.
 *
 * Idempotent — aman dijalankan berulang. Tidak akan duplicate rak yang
 * sudah ada (skip via @@unique([branchId, code])) dan tidak akan overwrite
 * defaultRackId produk yang sudah ada.
 *
 * Usage: npx tsx prisma/seed-racks-bulk.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MAX_RACKS_PER_BRANCH = 50;
// Filter: hanya proses company dengan nama ini (case-insensitive contains).
// Set ke null untuk proses semua company.
const COMPANY_FILTER: string | null = "Ahhas";

function rackCodeFor(categoryName: string, idx: number): string {
  // 2 huruf pertama (uppercase, A-Z only), pad nomor 2 digit.
  const letters = categoryName
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 2)
    .padEnd(2, "X");
  return `${letters}-${String(idx).padStart(2, "0")}`;
}

async function main() {
  console.log("=== Bulk Rack Seed & Product Migration ===\n");

  const companies = await prisma.company.findMany({
    where: COMPANY_FILTER
      ? { name: { contains: COMPANY_FILTER, mode: "insensitive" } }
      : undefined,
    select: {
      id: true,
      name: true,
      branches: {
        where: { isActive: true },
        select: { id: true, name: true, code: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (COMPANY_FILTER) {
    console.log(`Filter: company name contains "${COMPANY_FILTER}"`);
  }
  if (companies.length === 0) {
    console.log("No companies matched. Done.");
    return;
  }

  let totalRacksCreated = 0;
  let totalRacksSkipped = 0;
  let totalProductsAssigned = 0;
  let totalStockMigrated = 0;

  for (const company of companies) {
    if (company.branches.length === 0) continue;

    // Ambil kategori yang dipakai produk di company ini.
    const categoriesUsed = await prisma.category.findMany({
      where: {
        companyId: company.id,
        products: {
          some: { companyId: company.id, deletedAt: null },
        },
      },
      select: {
        id: true,
        name: true,
        _count: { select: { products: true } },
      },
      orderBy: { name: "asc" },
    });

    if (categoriesUsed.length === 0) {
      console.log(`[${company.name}] no categories with products — skip`);
      continue;
    }

    console.log(
      `\n[${company.name}] ${company.branches.length} branch(es), ${categoriesUsed.length} categor(ies)`,
    );

    // Limit kategori untuk dedicated rack ke MAX_RACKS_PER_BRANCH-1
    // (sisa 1 slot untuk MISC bucket).
    const dedicated = categoriesUsed.slice(0, MAX_RACKS_PER_BRANCH - 1);
    const overflow = categoriesUsed.slice(MAX_RACKS_PER_BRANCH - 1);
    const useMisc = overflow.length > 0;

    // Cek bentrok code di kategori (kalau 2 kategori mulai dengan 2 huruf
    // sama, kode akan duplikat). Bedakan dengan index counter per prefix.
    const prefixCounter = new Map<string, number>();
    const categoryToCode = new Map<string, string>(); // categoryId → code
    for (const cat of dedicated) {
      const letters = cat.name
        .toUpperCase()
        .replace(/[^A-Z]/g, "")
        .slice(0, 2)
        .padEnd(2, "X");
      const cur = prefixCounter.get(letters) ?? 0;
      const nextIdx = cur + 1;
      prefixCounter.set(letters, nextIdx);
      categoryToCode.set(cat.id, `${letters}-${String(nextIdx).padStart(2, "0")}`);
    }
    const miscCode = "MS-01";

    // Untuk setiap branch, buat rak.
    for (const branch of company.branches) {
      const racksToCreate: Array<{
        code: string;
        name: string;
        location: string;
        categoryIds: string[];
      }> = [];

      for (const cat of dedicated) {
        racksToCreate.push({
          code: categoryToCode.get(cat.id)!,
          name: `Rak ${cat.name}`,
          location: `Section ${categoryToCode.get(cat.id)!.split("-")[0]}`,
          categoryIds: [cat.id],
        });
      }
      if (useMisc) {
        racksToCreate.push({
          code: miscCode,
          name: "Rak Lain-Lain",
          location: "Section MISC",
          categoryIds: overflow.map((c) => c.id),
        });
      }

      // Map categoryId → rackId (di branch ini) untuk product assignment.
      const categoryToRackId = new Map<string, string>();
      let miscRackId: string | null = null;

      for (const r of racksToCreate) {
        // Skip kalau sudah ada (idempotent).
        const existing = await prisma.rack.findUnique({
          where: { branchId_code: { branchId: branch.id, code: r.code } },
          select: { id: true },
        });
        let rackId: string;
        if (existing) {
          rackId = existing.id;
          totalRacksSkipped++;
        } else {
          const created = await prisma.rack.create({
            data: {
              branchId: branch.id,
              companyId: company.id,
              code: r.code,
              name: r.name,
              location: r.location,
              isActive: true,
            },
            select: { id: true },
          });
          rackId = created.id;
          totalRacksCreated++;
        }
        if (r.code === miscCode) {
          miscRackId = rackId;
        } else {
          for (const catId of r.categoryIds) {
            categoryToRackId.set(catId, rackId);
          }
        }
      }

      console.log(
        `  ${branch.code ?? branch.name}: ${racksToCreate.length} racks (created/skipped tracked globally)`,
      );

      // Migrasi produk tanpa defaultRackId di company ini.
      // Strategi: ambil produk yang categori-nya match dengan rak di
      // branch ini. Hanya proses sekali per produk — di branch pertama
      // company (branch dengan createdAt paling awal).
      const isPrimaryBranch = branch.id === company.branches[0]?.id;
      if (!isPrimaryBranch) continue;

      const productsToAssign = await prisma.product.findMany({
        where: {
          companyId: company.id,
          defaultRackId: null,
          deletedAt: null,
        },
        select: {
          id: true,
          code: true,
          name: true,
          categoryId: true,
          branchStocks: {
            where: { branchId: branch.id },
            select: { quantity: true },
          },
        },
      });

      for (const p of productsToAssign) {
        const targetRackId =
          categoryToRackId.get(p.categoryId) ?? miscRackId;
        if (!targetRackId) continue;

        await prisma.product.update({
          where: { id: p.id },
          data: { defaultRackId: targetRackId },
        });
        totalProductsAssigned++;

        // Bila ada BranchStock di branch ini, populate RackStock juga.
        const stock = p.branchStocks[0]?.quantity ?? 0;
        if (stock > 0) {
          const existingRackStock = await prisma.rackStock.findUnique({
            where: {
              rackId_productId: {
                rackId: targetRackId,
                productId: p.id,
              },
            },
            select: { id: true },
          });
          if (!existingRackStock) {
            await prisma.$transaction([
              prisma.rackStock.create({
                data: {
                  rackId: targetRackId,
                  productId: p.id,
                  branchId: branch.id,
                  qty: stock,
                },
              }),
              prisma.rackStockMovement.create({
                data: {
                  productId: p.id,
                  branchId: branch.id,
                  toRackId: targetRackId,
                  qty: stock,
                  type: "MIGRATION",
                  refType: "bulk_seed",
                  notes: "Auto-assign via seed-racks-bulk",
                },
              }),
            ]);
            totalStockMigrated++;
          }
        }
      }
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Racks created  : ${totalRacksCreated}`);
  console.log(`Racks skipped  : ${totalRacksSkipped} (already existed)`);
  console.log(`Products       : ${totalProductsAssigned} assigned defaultRackId`);
  console.log(`RackStock pop  : ${totalStockMigrated} (qty > 0 migrated)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
