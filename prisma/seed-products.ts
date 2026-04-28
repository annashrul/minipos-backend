/**
 * Idempotent seed for F&B-style demo products.
 *
 * - Creates 4 categories (per company): "Makanan", "Minuman Kopi",
 *   "Minuman Non-Kopi", "Snack".
 * - Seeds ~30 products with names that match modifier seed keywords,
 *   so once linked the modifier picker on tablet (and POS) opens nicely.
 * - Auto-links to the 5 modifier groups created by `seed-modifiers.ts`
 *   (Level Pedas / Ukuran / Topping / Es / Gula) using the same keyword logic.
 *
 *   pnpm tsx prisma/seed-products.ts            # seed all companies
 *   pnpm tsx prisma/seed-products.ts <id>       # seed one company
 *
 * Re-runnable: products are upserted by (companyId, code).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type ProductSeed = {
  code: string;
  name: string;
  category: string;
  purchasePrice: number;
  sellingPrice: number;
  stock: number;
  minStock: number;
  unit: string;
  description?: string;
};

const CATEGORIES = [
  "Makanan",
  "Minuman Kopi",
  "Minuman Non-Kopi",
  "Snack",
] as const;

const PRODUCTS: ProductSeed[] = [
  // ── Makanan (will get Level Pedas + Topping) ───────────────────────
  { code: "FB-MIE-001",  name: "Mie Goreng Spesial",   category: "Makanan", purchasePrice: 12000, sellingPrice: 22000, stock: 50, minStock: 10, unit: "porsi" },
  { code: "FB-MIE-002",  name: "Mie Ayam Bakso",       category: "Makanan", purchasePrice: 13000, sellingPrice: 24000, stock: 50, minStock: 10, unit: "porsi" },
  { code: "FB-NASI-001", name: "Nasi Goreng Kampung",  category: "Makanan", purchasePrice: 14000, sellingPrice: 25000, stock: 60, minStock: 10, unit: "porsi" },
  { code: "FB-NASI-002", name: "Nasi Ayam Geprek",     category: "Makanan", purchasePrice: 15000, sellingPrice: 28000, stock: 60, minStock: 10, unit: "porsi" },
  { code: "FB-NASI-003", name: "Nasi Rendang",         category: "Makanan", purchasePrice: 18000, sellingPrice: 32000, stock: 40, minStock: 8,  unit: "porsi" },
  { code: "FB-AYAM-001", name: "Ayam Bakar Madu",      category: "Makanan", purchasePrice: 16000, sellingPrice: 30000, stock: 40, minStock: 8,  unit: "porsi" },
  { code: "FB-AYAM-002", name: "Ayam Rica-Rica",       category: "Makanan", purchasePrice: 16500, sellingPrice: 31000, stock: 40, minStock: 8,  unit: "porsi" },
  { code: "FB-BAKSO-001", name: "Bakso Sapi Mantap",   category: "Makanan", purchasePrice: 11000, sellingPrice: 20000, stock: 50, minStock: 10, unit: "porsi" },
  { code: "FB-SOTO-001", name: "Soto Ayam Lamongan",   category: "Makanan", purchasePrice: 13000, sellingPrice: 23000, stock: 40, minStock: 8,  unit: "porsi" },
  { code: "FB-SATE-001", name: "Sate Ayam (10 tusuk)", category: "Makanan", purchasePrice: 18000, sellingPrice: 35000, stock: 30, minStock: 6,  unit: "porsi" },
  { code: "FB-SEBLAK-001", name: "Seblak Komplit",     category: "Makanan", purchasePrice: 10000, sellingPrice: 19000, stock: 30, minStock: 6,  unit: "porsi" },
  { code: "FB-TAHU-001",  name: "Tahu Telur Madura",   category: "Makanan", purchasePrice: 9000,  sellingPrice: 17000, stock: 40, minStock: 8,  unit: "porsi" },

  // ── Minuman Kopi (Ukuran + Es + Gula + Topping) ────────────────────
  { code: "BV-COFF-001", name: "Kopi Susu Gula Aren",  category: "Minuman Kopi", purchasePrice: 6000,  sellingPrice: 18000, stock: 100, minStock: 15, unit: "cup" },
  { code: "BV-COFF-002", name: "Es Kopi Latte",         category: "Minuman Kopi", purchasePrice: 7000,  sellingPrice: 22000, stock: 100, minStock: 15, unit: "cup" },
  { code: "BV-COFF-003", name: "Americano",             category: "Minuman Kopi", purchasePrice: 6500,  sellingPrice: 20000, stock: 100, minStock: 15, unit: "cup" },
  { code: "BV-COFF-004", name: "Cappuccino",            category: "Minuman Kopi", purchasePrice: 7000,  sellingPrice: 23000, stock: 100, minStock: 15, unit: "cup" },
  { code: "BV-COFF-005", name: "Espresso Single",       category: "Minuman Kopi", purchasePrice: 5500,  sellingPrice: 15000, stock: 100, minStock: 15, unit: "cup" },
  { code: "BV-COFF-006", name: "Mocha Frappe",          category: "Minuman Kopi", purchasePrice: 8500,  sellingPrice: 26000, stock: 80,  minStock: 12, unit: "cup" },

  // ── Minuman Non-Kopi (Ukuran + Es + Gula) ──────────────────────────
  { code: "BV-TEA-001",   name: "Teh Tarik Susu",      category: "Minuman Non-Kopi", purchasePrice: 5000, sellingPrice: 16000, stock: 100, minStock: 15, unit: "cup" },
  { code: "BV-TEA-002",   name: "Es Teh Manis",        category: "Minuman Non-Kopi", purchasePrice: 2500, sellingPrice: 8000,  stock: 150, minStock: 20, unit: "gelas" },
  { code: "BV-TEA-003",   name: "Matcha Latte",        category: "Minuman Non-Kopi", purchasePrice: 8000, sellingPrice: 24000, stock: 80,  minStock: 12, unit: "cup" },
  { code: "BV-MILK-001",  name: "Susu Coklat Boba",    category: "Minuman Non-Kopi", purchasePrice: 8500, sellingPrice: 25000, stock: 80,  minStock: 12, unit: "cup" },
  { code: "BV-MILK-002",  name: "Milk Shake Vanila",   category: "Minuman Non-Kopi", purchasePrice: 9000, sellingPrice: 28000, stock: 60,  minStock: 10, unit: "cup" },
  { code: "BV-JUS-001",   name: "Jus Mangga",          category: "Minuman Non-Kopi", purchasePrice: 6500, sellingPrice: 20000, stock: 60,  minStock: 10, unit: "cup" },
  { code: "BV-JUS-002",   name: "Jus Alpukat",         category: "Minuman Non-Kopi", purchasePrice: 7500, sellingPrice: 22000, stock: 60,  minStock: 10, unit: "cup" },
  { code: "BV-LEM-001",   name: "Lemonade Strawberry", category: "Minuman Non-Kopi", purchasePrice: 6000, sellingPrice: 19000, stock: 80,  minStock: 12, unit: "cup" },
  { code: "BV-SODA-001",  name: "Soda Gembira",        category: "Minuman Non-Kopi", purchasePrice: 6000, sellingPrice: 18000, stock: 80,  minStock: 12, unit: "cup" },

  // ── Snack (no modifier — tests "no extras" path) ───────────────────
  { code: "SN-001", name: "Kentang Goreng",  category: "Snack", purchasePrice: 5000,  sellingPrice: 15000, stock: 80, minStock: 10, unit: "porsi" },
  { code: "SN-002", name: "Pisang Goreng",   category: "Snack", purchasePrice: 4000,  sellingPrice: 12000, stock: 80, minStock: 10, unit: "porsi" },
  { code: "SN-003", name: "Roti Bakar",      category: "Snack", purchasePrice: 5500,  sellingPrice: 14000, stock: 60, minStock: 10, unit: "porsi" },
  { code: "SN-004", name: "Donut Coklat",    category: "Snack", purchasePrice: 4000,  sellingPrice: 10000, stock: 80, minStock: 10, unit: "pcs" },
];

// ─── Modifier auto-link (mirror of seed-modifiers.ts heuristic) ─────────
const MODIFIER_KEYWORDS: Record<string, string[]> = {
  "Level Pedas": ["mie", "nasi", "ayam", "bakso", "soto", "sate", "rendang", "geprek", "seblak", "tahu", "tempe", "telur", "rica", "balado"],
  "Ukuran":      ["kopi", "teh", "juice", "jus", "susu", "milk", "latte", "americano", "espresso", "cappuccino", "mocha", "matcha", "smoothie", "shake", "lemonade", "soda", "es ", "ice", "boba"],
  "Topping":     ["mie", "nasi", "ayam", "bakso", "kopi", "teh", "boba", "milk", "susu", "shake", "matcha"],
  "Es":          ["kopi", "teh", "juice", "jus", "es ", "ice", "lemonade", "soda", "milk", "susu", "boba", "shake", "smoothie", "matcha", "latte"],
  "Gula":        ["kopi", "teh", "juice", "jus", "lemonade", "milk", "susu", "boba", "shake", "smoothie", "matcha", "latte", "americano", "cappuccino"],
};

function matchesAny(name: string, keywords: string[]): boolean {
  const lower = name.toLowerCase();
  return keywords.some((k) => lower.includes(k));
}

async function ensureCategory(companyId: string, name: string): Promise<string> {
  const cat = await prisma.category.upsert({
    where: { companyId_name: { companyId, name } },
    update: {},
    create: { companyId, name },
    select: { id: true },
  });
  return cat.id;
}

async function seedForCompany(companyId: string, companyName: string) {
  console.log(`\n→ Company: ${companyName} (${companyId})`);

  // 1. Categories
  const categoryIdByName = new Map<string, string>();
  for (const c of CATEGORIES) {
    const id = await ensureCategory(companyId, c);
    categoryIdByName.set(c, id);
  }
  console.log(`  · ${CATEGORIES.length} kategori siap`);

  // 2. Existing modifier groups (created by seed-modifiers.ts) — load by name
  const groups = await prisma.modifierGroup.findMany({
    where: { companyId },
    select: { id: true, name: true, sortOrder: true },
  });
  const groupIdByName = new Map(groups.map((g) => [g.name, g.id]));
  if (groupIdByName.size === 0) {
    console.log(`  ! No modifier groups yet — run \`pnpm db:seed:modifiers\` first to enable auto-link.`);
  }

  // 3. Upsert products + auto-link modifiers
  let createdCount = 0;
  let updatedCount = 0;
  let linkCount = 0;

  for (const p of PRODUCTS) {
    const categoryId = categoryIdByName.get(p.category);
    if (!categoryId) {
      console.warn(`  ! Skip ${p.code} — kategori "${p.category}" tidak ditemukan`);
      continue;
    }

    const existing = await prisma.product.findUnique({
      where: { companyId_code: { companyId, code: p.code } },
      select: { id: true },
    });

    const data = {
      name: p.name,
      categoryId,
      purchasePrice: p.purchasePrice,
      sellingPrice: p.sellingPrice,
      stock: p.stock,
      minStock: p.minStock,
      unit: p.unit,
      isActive: true,
      description: p.description ?? null,
    };

    let productId: string;
    if (existing) {
      const u = await prisma.product.update({
        where: { id: existing.id },
        data,
        select: { id: true },
      });
      productId = u.id;
      updatedCount++;
    } else {
      const c = await prisma.product.create({
        data: { ...data, code: p.code, companyId },
        select: { id: true },
      });
      productId = c.id;
      createdCount++;
    }

    // Link modifier groups by keyword match
    for (const [groupName, keywords] of Object.entries(MODIFIER_KEYWORDS)) {
      if (!matchesAny(p.name, keywords)) continue;
      const groupId = groupIdByName.get(groupName);
      if (!groupId) continue;
      await prisma.productModifierGroup.upsert({
        where: {
          productId_modifierGroupId: { productId, modifierGroupId: groupId },
        },
        update: {},
        create: { productId, modifierGroupId: groupId, sortOrder: 0 },
      });
      linkCount++;
    }
  }

  console.log(
    `  ✓ ${createdCount} produk baru, ${updatedCount} diupdate, ${linkCount} link modifier`,
  );
}

async function main() {
  const onlyCompanyId = process.argv[2];

  const companies = await prisma.company.findMany({
    where: onlyCompanyId ? { id: onlyCompanyId } : undefined,
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  if (companies.length === 0) {
    console.log("No companies found — nothing to seed.");
    return;
  }

  console.log(`Seeding products for ${companies.length} company(ies)...`);
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
