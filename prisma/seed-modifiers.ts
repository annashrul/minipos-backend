/**
 * Idempotent seed for ModifierGroup, ModifierOption, and ProductModifierGroup links.
 *
 * Creates 5 generic F&B modifier groups per company:
 *   1. Level Pedas    (required, pilih 1)
 *   2. Ukuran         (required, pilih 1)
 *   3. Topping        (opsional, pilih 0-3)
 *   4. Es             (opsional, pilih 1)
 *   5. Gula           (opsional, pilih 1)
 *
 * Auto-attaches groups to products by name keywords (best-effort heuristic).
 * Run multiple times safely — re-runs only sync missing rows / link.
 *
 *   pnpm tsx prisma/seed-modifiers.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type GroupSeed = {
  name: string;
  required: boolean;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  options: { name: string; priceAdjustment: number }[];
  /** Lower-case keywords; product whose name contains ANY → auto-link this group. */
  matchKeywords: string[];
};

const GROUPS: GroupSeed[] = [
  {
    name: "Level Pedas",
    required: true,
    minSelect: 1,
    maxSelect: 1,
    sortOrder: 1,
    options: [
      { name: "Tidak Pedas", priceAdjustment: 0 },
      { name: "Sedang", priceAdjustment: 0 },
      { name: "Pedas", priceAdjustment: 0 },
      { name: "Extra Pedas", priceAdjustment: 2000 },
    ],
    matchKeywords: [
      "mie", "nasi", "ayam", "bakso", "soto", "sate", "rendang",
      "geprek", "seblak", "tahu", "tempe", "telur", "rica", "balado",
    ],
  },
  {
    name: "Ukuran",
    required: true,
    minSelect: 1,
    maxSelect: 1,
    sortOrder: 2,
    options: [
      { name: "Regular", priceAdjustment: 0 },
      { name: "Large", priceAdjustment: 5000 },
      { name: "Jumbo", priceAdjustment: 10000 },
    ],
    matchKeywords: [
      "kopi", "teh", "juice", "jus", "susu", "milk", "latte", "americano",
      "espresso", "cappuccino", "mocha", "matcha", "smoothie", "shake",
      "lemonade", "soda", "es ", "ice", "boba",
    ],
  },
  {
    name: "Topping",
    required: false,
    minSelect: 0,
    maxSelect: 3,
    sortOrder: 3,
    options: [
      { name: "Telur", priceAdjustment: 3000 },
      { name: "Sosis", priceAdjustment: 6000 },
      { name: "Cheese", priceAdjustment: 5000 },
      { name: "Mozzarella", priceAdjustment: 8000 },
      { name: "Bakso", priceAdjustment: 5000 },
      { name: "Boba", priceAdjustment: 4000 },
    ],
    matchKeywords: [
      "mie", "nasi", "ayam", "bakso", "kopi", "teh", "boba", "milk",
      "susu", "shake", "matcha",
    ],
  },
  {
    name: "Es",
    required: false,
    minSelect: 1,
    maxSelect: 1,
    sortOrder: 4,
    options: [
      { name: "Normal Ice", priceAdjustment: 0 },
      { name: "Less Ice", priceAdjustment: 0 },
      { name: "No Ice", priceAdjustment: 0 },
    ],
    matchKeywords: [
      "kopi", "teh", "juice", "jus", "es ", "ice", "lemonade", "soda",
      "milk", "susu", "boba", "shake", "smoothie", "matcha", "latte",
    ],
  },
  {
    name: "Gula",
    required: false,
    minSelect: 1,
    maxSelect: 1,
    sortOrder: 5,
    options: [
      { name: "Normal Sugar", priceAdjustment: 0 },
      { name: "Less Sugar", priceAdjustment: 0 },
      { name: "No Sugar", priceAdjustment: 0 },
    ],
    matchKeywords: [
      "kopi", "teh", "juice", "jus", "lemonade", "milk", "susu", "boba",
      "shake", "smoothie", "matcha", "latte", "americano", "cappuccino",
    ],
  },
];

function matchesAny(productName: string, keywords: string[]): boolean {
  const lower = productName.toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

async function seedForCompany(companyId: string, companyName: string) {
  console.log(`\n→ Company: ${companyName} (${companyId})`);

  // 1. Upsert each group (no unique on (companyId, name) — find-then-create/update)
  const groupIdByName = new Map<string, string>();
  for (const g of GROUPS) {
    let group = await prisma.modifierGroup.findFirst({
      where: { companyId, name: g.name },
      select: { id: true },
    });
    if (!group) {
      group = await prisma.modifierGroup.create({
        data: {
          companyId,
          name: g.name,
          required: g.required,
          minSelect: g.minSelect,
          maxSelect: g.maxSelect,
          sortOrder: g.sortOrder,
          isActive: true,
        },
        select: { id: true },
      });
      console.log(`  + Group: ${g.name}`);
    } else {
      await prisma.modifierGroup.update({
        where: { id: group.id },
        data: {
          required: g.required,
          minSelect: g.minSelect,
          maxSelect: g.maxSelect,
          sortOrder: g.sortOrder,
          isActive: true,
        },
      });
      console.log(`  ↺ Group: ${g.name}`);
    }
    groupIdByName.set(g.name, group.id);

    // 2. Upsert each option (no unique on (groupId, name) — find-then-create/update)
    for (const [idx, opt] of g.options.entries()) {
      const existing = await prisma.modifierOption.findFirst({
        where: { groupId: group.id, name: opt.name },
        select: { id: true },
      });
      if (!existing) {
        await prisma.modifierOption.create({
          data: {
            groupId: group.id,
            name: opt.name,
            priceAdjustment: opt.priceAdjustment,
            isActive: true,
            sortOrder: idx,
          },
        });
      } else {
        await prisma.modifierOption.update({
          where: { id: existing.id },
          data: {
            priceAdjustment: opt.priceAdjustment,
            isActive: true,
            sortOrder: idx,
          },
        });
      }
    }
  }

  // 3. Auto-attach groups to matching products
  const products = await prisma.product.findMany({
    where: { companyId, isActive: true, deletedAt: null },
    select: { id: true, name: true },
  });
  console.log(`  · Scanning ${products.length} products for keyword match...`);

  let linkCount = 0;
  for (const p of products) {
    for (const g of GROUPS) {
      if (!matchesAny(p.name, g.matchKeywords)) continue;
      const groupId = groupIdByName.get(g.name);
      if (!groupId) continue;
      await prisma.productModifierGroup.upsert({
        where: {
          productId_modifierGroupId: { productId: p.id, modifierGroupId: groupId },
        },
        update: { sortOrder: g.sortOrder },
        create: {
          productId: p.id,
          modifierGroupId: groupId,
          sortOrder: g.sortOrder,
        },
      });
      linkCount++;
    }
  }
  console.log(`  ✓ ${linkCount} product↔group links synced`);
}

async function main() {
  const onlyCompanyId = process.argv[2]; // optional CLI arg

  const companies = await prisma.company.findMany({
    where: onlyCompanyId ? { id: onlyCompanyId } : undefined,
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  if (companies.length === 0) {
    console.log("No companies found — nothing to seed.");
    return;
  }
  console.log(`Seeding modifiers for ${companies.length} company(ies)...`);
  for (const c of companies) {
    await seedForCompany(c.id, c.name);
  }
  console.log("\nDone.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
