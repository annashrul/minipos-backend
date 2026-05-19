/**
 * One-shot migration: untuk setiap produk yang punya defaultRackId, buat
 * RackStock entry dengan qty = BranchStock.quantity (kalau belum ada).
 *
 * Idempotent — aman dijalankan berulang. Tidak akan overwrite RackStock yang
 * sudah ada.
 *
 * Usage: npx ts-node prisma/seed-rack-stock-migration.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("=== Migration: BranchStock → RackStock ===\n");

  const products = await prisma.product.findMany({
    where: { defaultRackId: { not: null } },
    select: {
      id: true,
      code: true,
      name: true,
      defaultRackId: true,
      branchStocks: {
        select: { branchId: true, quantity: true },
      },
    },
  });

  console.log(`Found ${products.length} products with defaultRackId.\n`);

  let migrated = 0;
  let skipped = 0;
  let zeroStock = 0;

  for (const p of products) {
    if (!p.defaultRackId) continue;

    const rack = await prisma.rack.findUnique({
      where: { id: p.defaultRackId },
      select: { id: true, branchId: true, code: true },
    });
    if (!rack) {
      console.warn(
        `⚠️  ${p.code} (${p.name}): defaultRackId pointing to deleted rack — skip`,
      );
      skipped++;
      continue;
    }

    const branchStock = p.branchStocks.find((bs) => bs.branchId === rack.branchId);
    if (!branchStock) {
      console.warn(
        `⚠️  ${p.code}: no BranchStock for rack's branch — skip`,
      );
      skipped++;
      continue;
    }
    if (branchStock.quantity === 0) {
      zeroStock++;
      continue;
    }

    const existing = await prisma.rackStock.findUnique({
      where: { rackId_productId: { rackId: rack.id, productId: p.id } },
      select: { id: true, qty: true },
    });
    if (existing) {
      console.log(
        `↷  ${p.code} → ${rack.code}: already has RackStock (qty=${existing.qty}) — skip`,
      );
      skipped++;
      continue;
    }

    await prisma.$transaction(async (tx) => {
      await tx.rackStock.create({
        data: {
          rackId: rack.id,
          productId: p.id,
          branchId: rack.branchId,
          qty: branchStock.quantity,
        },
      });
      await tx.rackStockMovement.create({
        data: {
          productId: p.id,
          branchId: rack.branchId,
          toRackId: rack.id,
          qty: branchStock.quantity,
          type: "MIGRATION",
          refType: "branch_stock_migration",
          notes: "Migrasi otomatis dari BranchStock ke RackStock",
        },
      });
    });
    console.log(
      `✓  ${p.code} (${p.name}) → ${rack.code}: qty=${branchStock.quantity}`,
    );
    migrated++;
  }

  console.log("\n=== Summary ===");
  console.log(`Migrated : ${migrated}`);
  console.log(`Skipped  : ${skipped}`);
  console.log(`Zero stk : ${zeroStock}`);
  console.log(`Total    : ${products.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
