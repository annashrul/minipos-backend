/**
 * Seed produk real untuk company Ahhas (motorcycle workshop / AHASS).
 *
 * - Skip produk yang sudah ada (match by code).
 * - Auto-assign defaultRackId via kategori → rak (yang sudah di-seed).
 * - Create BranchStock untuk semua cabang aktif.
 * - Create RackStock + RackStockMovement type=MIGRATION untuk seed stok awal.
 *
 * Usage: npx tsx prisma/seed-ahhas-products.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type ProductSeed = {
  code: string;
  name: string;
  categoryName: string;
  brandName: string;
  unit: string;
  purchasePrice: number;
  sellingPrice: number;
  initialStock: number;
  barcode?: string;
  description?: string;
};

const PRODUCTS: ProductSeed[] = [
  // ====================== OLI ======================
  {
    code: "OLI-007",
    name: "AHM Oil SPX2 Matic 0.8L",
    categoryName: "Oli",
    brandName: "AHM",
    unit: "botol",
    purchasePrice: 42000,
    sellingPrice: 58000,
    initialStock: 40,
  },
  {
    code: "OLI-008",
    name: "AHM Oil MPX2 10W-30 0.8L",
    categoryName: "Oli",
    brandName: "AHM",
    unit: "botol",
    purchasePrice: 42000,
    sellingPrice: 60000,
    initialStock: 35,
  },
  {
    code: "OLI-009",
    name: "Yamalube Power Matic 10W-40 0.8L",
    categoryName: "Oli",
    brandName: "Yamalube",
    unit: "botol",
    purchasePrice: 45000,
    sellingPrice: 62000,
    initialStock: 25,
  },
  {
    code: "OLI-010",
    name: "Federal Matic Ultratec 10W-30 0.8L",
    categoryName: "Oli",
    brandName: "Federal",
    unit: "botol",
    purchasePrice: 38000,
    sellingPrice: 55000,
    initialStock: 30,
  },
  {
    code: "OLI-011",
    name: "Shell Advance AX5 15W-40 1L",
    categoryName: "Oli",
    brandName: "House Brand",
    unit: "botol",
    purchasePrice: 55000,
    sellingPrice: 75000,
    initialStock: 20,
  },
  {
    code: "OLI-012",
    name: "AHM Oil Gear Final Drive 120ml",
    categoryName: "Oli",
    brandName: "AHM",
    unit: "botol",
    purchasePrice: 15000,
    sellingPrice: 22000,
    initialStock: 50,
  },
  {
    code: "OLI-013",
    name: "Castrol Power 1 4T 10W-40 1L",
    categoryName: "Oli",
    brandName: "House Brand",
    unit: "botol",
    purchasePrice: 60000,
    sellingPrice: 85000,
    initialStock: 18,
  },
  {
    code: "OLI-014",
    name: "Yamalube Sport 15W-50 1L",
    categoryName: "Oli",
    brandName: "Yamalube",
    unit: "botol",
    purchasePrice: 65000,
    sellingPrice: 90000,
    initialStock: 15,
  },

  // ====================== BAN ======================
  {
    code: "BAN-004",
    name: "Ban FDR Sport XR Evo 80/80-14",
    categoryName: "Ban",
    brandName: "Federal",
    unit: "pcs",
    purchasePrice: 165000,
    sellingPrice: 220000,
    initialStock: 12,
  },
  {
    code: "BAN-005",
    name: "Ban Corsa Platinum R26 90/80-14",
    categoryName: "Ban",
    brandName: "Federal",
    unit: "pcs",
    purchasePrice: 220000,
    sellingPrice: 285000,
    initialStock: 10,
  },
  {
    code: "BAN-006",
    name: "Ban IRC Tubeless 70/90-14 (Beat/Vario)",
    categoryName: "Ban",
    brandName: "House Brand",
    unit: "pcs",
    purchasePrice: 145000,
    sellingPrice: 195000,
    initialStock: 14,
  },
  {
    code: "BAN-007",
    name: "Ban FDR Genzi 100/80-14 (NMAX/PCX)",
    categoryName: "Ban",
    brandName: "Federal",
    unit: "pcs",
    purchasePrice: 280000,
    sellingPrice: 365000,
    initialStock: 8,
  },
  {
    code: "BAN-008",
    name: "Ban Pirelli Diablo Rosso 110/70-17",
    categoryName: "Ban",
    brandName: "House Brand",
    unit: "pcs",
    purchasePrice: 850000,
    sellingPrice: 1100000,
    initialStock: 4,
  },
  {
    code: "BAN-009",
    name: "Ban Dalam IRC 70/90-14",
    categoryName: "Ban",
    brandName: "House Brand",
    unit: "pcs",
    purchasePrice: 28000,
    sellingPrice: 45000,
    initialStock: 30,
  },
  {
    code: "BAN-010",
    name: "Ban Mizzle MT75 80/90-17",
    categoryName: "Ban",
    brandName: "House Brand",
    unit: "pcs",
    purchasePrice: 175000,
    sellingPrice: 235000,
    initialStock: 10,
  },

  // ====================== BUSI ======================
  {
    code: "BSI-005",
    name: "NGK CR7HSA (Beat/Scoopy/Mio)",
    categoryName: "Busi",
    brandName: "NGK",
    unit: "pcs",
    purchasePrice: 18000,
    sellingPrice: 28000,
    initialStock: 60,
  },
  {
    code: "BSI-006",
    name: "NGK CR8E (Vario/PCX/Aerox)",
    categoryName: "Busi",
    brandName: "NGK",
    unit: "pcs",
    purchasePrice: 22000,
    sellingPrice: 32000,
    initialStock: 50,
  },
  {
    code: "BSI-007",
    name: "NGK Iridium CR8EIX",
    categoryName: "Busi",
    brandName: "NGK",
    unit: "pcs",
    purchasePrice: 90000,
    sellingPrice: 135000,
    initialStock: 20,
  },
  {
    code: "BSI-008",
    name: "NGK MotoDX CR7HDX-S",
    categoryName: "Busi",
    brandName: "NGK",
    unit: "pcs",
    purchasePrice: 95000,
    sellingPrice: 140000,
    initialStock: 15,
  },
  {
    code: "BSI-009",
    name: "Denso Iridium IUH27D",
    categoryName: "Busi",
    brandName: "House Brand",
    unit: "pcs",
    purchasePrice: 85000,
    sellingPrice: 125000,
    initialStock: 12,
  },
  {
    code: "BSI-010",
    name: "Busi Champion RG6YC (Mobil)",
    categoryName: "Busi",
    brandName: "House Brand",
    unit: "pcs",
    purchasePrice: 35000,
    sellingPrice: 55000,
    initialStock: 25,
  },

  // ====================== FILTER ======================
  {
    code: "FLT-006",
    name: "Filter Udara Vario 125/150 (Original)",
    categoryName: "Filter",
    brandName: "AHM",
    unit: "pcs",
    purchasePrice: 38000,
    sellingPrice: 55000,
    initialStock: 25,
  },
  {
    code: "FLT-007",
    name: "Filter Udara Beat/Scoopy (Original)",
    categoryName: "Filter",
    brandName: "AHM",
    unit: "pcs",
    purchasePrice: 35000,
    sellingPrice: 50000,
    initialStock: 30,
  },
  {
    code: "FLT-008",
    name: "Filter Udara NMAX/Aerox (Original)",
    categoryName: "Filter",
    brandName: "Yamaha",
    unit: "pcs",
    purchasePrice: 42000,
    sellingPrice: 60000,
    initialStock: 20,
  },
  {
    code: "FLT-009",
    name: "Filter Oli PCX 160 (Original)",
    categoryName: "Filter",
    brandName: "AHM",
    unit: "pcs",
    purchasePrice: 30000,
    sellingPrice: 45000,
    initialStock: 18,
  },
  {
    code: "FLT-010",
    name: "Filter Oli Vario 150 (Original)",
    categoryName: "Filter",
    brandName: "AHM",
    unit: "pcs",
    purchasePrice: 28000,
    sellingPrice: 42000,
    initialStock: 22,
  },
  {
    code: "FLT-011",
    name: "Filter Bensin Universal Motor",
    categoryName: "Filter",
    brandName: "House Brand",
    unit: "pcs",
    purchasePrice: 15000,
    sellingPrice: 25000,
    initialStock: 40,
  },
  {
    code: "FLT-012",
    name: "Filter AC Mobil Toyota Avanza",
    categoryName: "Filter",
    brandName: "Toyota",
    unit: "pcs",
    purchasePrice: 55000,
    sellingPrice: 85000,
    initialStock: 10,
  },
  {
    code: "FLT-013",
    name: "Filter Udara Mobil Daihatsu Xenia",
    categoryName: "Filter",
    brandName: "Daihatsu",
    unit: "pcs",
    purchasePrice: 65000,
    sellingPrice: 95000,
    initialStock: 8,
  },

  // ====================== AKI ======================
  {
    code: "AKI-005",
    name: "Aki Motor GS Astra GTZ5S MF (Beat/Vario)",
    categoryName: "Aki",
    brandName: "GS Astra",
    unit: "pcs",
    purchasePrice: 165000,
    sellingPrice: 225000,
    initialStock: 15,
  },
  {
    code: "AKI-006",
    name: "Aki Motor Yuasa YTZ7V (PCX/NMAX)",
    categoryName: "Aki",
    brandName: "Yuasa",
    unit: "pcs",
    purchasePrice: 285000,
    sellingPrice: 385000,
    initialStock: 10,
  },
  {
    code: "AKI-007",
    name: "Aki Motor GS Astra GTZ4V MF (Mio/Scoopy)",
    categoryName: "Aki",
    brandName: "GS Astra",
    unit: "pcs",
    purchasePrice: 145000,
    sellingPrice: 195000,
    initialStock: 12,
  },
  {
    code: "AKI-008",
    name: "Aki Mobil GS Astra NS40Z (44Ah)",
    categoryName: "Aki",
    brandName: "GS Astra",
    unit: "pcs",
    purchasePrice: 650000,
    sellingPrice: 850000,
    initialStock: 6,
  },
  {
    code: "AKI-009",
    name: "Aki Mobil Yuasa NS60 (45Ah)",
    categoryName: "Aki",
    brandName: "Yuasa",
    unit: "pcs",
    purchasePrice: 720000,
    sellingPrice: 925000,
    initialStock: 5,
  },
  {
    code: "AKI-010",
    name: "Aki Mobil Bosch DIN55 (55Ah)",
    categoryName: "Aki",
    brandName: "Bosch",
    unit: "pcs",
    purchasePrice: 980000,
    sellingPrice: 1250000,
    initialStock: 4,
  },

  // ====================== KAMPAS REM ======================
  {
    code: "KMP-005",
    name: "Kampas Rem Depan Vario 125 (Original)",
    categoryName: "Kampas Rem",
    brandName: "AHM",
    unit: "set",
    purchasePrice: 48000,
    sellingPrice: 70000,
    initialStock: 25,
  },
  {
    code: "KMP-006",
    name: "Kampas Rem Belakang Vario 125 (Original)",
    categoryName: "Kampas Rem",
    brandName: "AHM",
    unit: "set",
    purchasePrice: 38000,
    sellingPrice: 58000,
    initialStock: 25,
  },
  {
    code: "KMP-007",
    name: "Kampas Rem Depan Beat/Scoopy (Aspira)",
    categoryName: "Kampas Rem",
    brandName: "Aspira",
    unit: "set",
    purchasePrice: 32000,
    sellingPrice: 48000,
    initialStock: 30,
  },
  {
    code: "KMP-008",
    name: "Kampas Rem Depan NMAX (Original)",
    categoryName: "Kampas Rem",
    brandName: "Yamaha",
    unit: "set",
    purchasePrice: 55000,
    sellingPrice: 80000,
    initialStock: 18,
  },
  {
    code: "KMP-009",
    name: "Kampas Rem Tromol Mio M3 (Federal)",
    categoryName: "Kampas Rem",
    brandName: "Federal",
    unit: "set",
    purchasePrice: 28000,
    sellingPrice: 42000,
    initialStock: 22,
  },
  {
    code: "KMP-010",
    name: "Kampas Kopling CB150R (Original)",
    categoryName: "Kampas Rem",
    brandName: "AHM",
    unit: "set",
    purchasePrice: 165000,
    sellingPrice: 225000,
    initialStock: 8,
  },

  // ====================== LAMPU ======================
  {
    code: "LMP-005",
    name: "Lampu LED Vario 150 H7 (12V)",
    categoryName: "Lampu",
    brandName: "House Brand",
    unit: "pcs",
    purchasePrice: 85000,
    sellingPrice: 135000,
    initialStock: 20,
  },
  {
    code: "LMP-006",
    name: "Lampu LED Beat/Scoopy AC 35/35W",
    categoryName: "Lampu",
    brandName: "House Brand",
    unit: "pcs",
    purchasePrice: 65000,
    sellingPrice: 105000,
    initialStock: 25,
  },
  {
    code: "LMP-007",
    name: "Bohlam Halogen NMAX H7 12V 55W",
    categoryName: "Lampu",
    brandName: "House Brand",
    unit: "pcs",
    purchasePrice: 35000,
    sellingPrice: 55000,
    initialStock: 30,
  },
  {
    code: "LMP-008",
    name: "Lampu Sein LED Universal (Sepasang)",
    categoryName: "Lampu",
    brandName: "House Brand",
    unit: "set",
    purchasePrice: 45000,
    sellingPrice: 75000,
    initialStock: 22,
  },
  {
    code: "LMP-009",
    name: "Lampu Rem LED Belakang Motor",
    categoryName: "Lampu",
    brandName: "House Brand",
    unit: "pcs",
    purchasePrice: 38000,
    sellingPrice: 60000,
    initialStock: 28,
  },
  {
    code: "LMP-010",
    name: "Lampu HID Mobil H4 6000K (Sepasang)",
    categoryName: "Lampu",
    brandName: "Bosch",
    unit: "set",
    purchasePrice: 380000,
    sellingPrice: 525000,
    initialStock: 6,
  },

  // ====================== AKSESORIS ======================
  {
    code: "AKS-006",
    name: "Helm Full Face KYT (Hitam)",
    categoryName: "Aksesoris",
    brandName: "Aspira",
    unit: "pcs",
    purchasePrice: 285000,
    sellingPrice: 395000,
    initialStock: 8,
  },
  {
    code: "AKS-007",
    name: "Jas Hujan Setelan Axio (XL)",
    categoryName: "Aksesoris",
    brandName: "House Brand",
    unit: "set",
    purchasePrice: 85000,
    sellingPrice: 135000,
    initialStock: 18,
  },
  {
    code: "AKS-008",
    name: "Sarung Tangan Motor Anti Selip",
    categoryName: "Aksesoris",
    brandName: "House Brand",
    unit: "pasang",
    purchasePrice: 45000,
    sellingPrice: 75000,
    initialStock: 25,
  },
  {
    code: "AKS-009",
    name: "Kunci Stang Pengaman Motor",
    categoryName: "Aksesoris",
    brandName: "House Brand",
    unit: "pcs",
    purchasePrice: 65000,
    sellingPrice: 95000,
    initialStock: 15,
  },
  {
    code: "AKS-010",
    name: "Spion Motor Universal (Sepasang)",
    categoryName: "Aksesoris",
    brandName: "Aspira",
    unit: "set",
    purchasePrice: 55000,
    sellingPrice: 85000,
    initialStock: 20,
  },
  {
    code: "AKS-011",
    name: "Spakbor Belakang Vario (Hugger)",
    categoryName: "Aksesoris",
    brandName: "House Brand",
    unit: "pcs",
    purchasePrice: 75000,
    sellingPrice: 115000,
    initialStock: 12,
  },
  {
    code: "AKS-012",
    name: "Klakson Keong Mobil (Sepasang)",
    categoryName: "Aksesoris",
    brandName: "Bosch",
    unit: "set",
    purchasePrice: 95000,
    sellingPrice: 145000,
    initialStock: 10,
  },
  {
    code: "AKS-013",
    name: "Karpet Dasar Motor PCX 160",
    categoryName: "Aksesoris",
    brandName: "House Brand",
    unit: "pcs",
    purchasePrice: 38000,
    sellingPrice: 60000,
    initialStock: 16,
  },
  {
    code: "AKS-014",
    name: "Stiker Body Motor Vario (Set)",
    categoryName: "Aksesoris",
    brandName: "House Brand",
    unit: "set",
    purchasePrice: 25000,
    sellingPrice: 45000,
    initialStock: 35,
  },
  {
    code: "AKS-015",
    name: "Tas Tangki Motor Touring",
    categoryName: "Aksesoris",
    brandName: "House Brand",
    unit: "pcs",
    purchasePrice: 165000,
    sellingPrice: 245000,
    initialStock: 6,
  },
];

async function main() {
  console.log(`=== Seed Ahhas Products (${PRODUCTS.length} items) ===\n`);

  const ahhas = await prisma.company.findFirst({
    where: { name: { contains: "Ahhas", mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (!ahhas) {
    console.error("Company Ahhas not found");
    return;
  }

  const [categories, brands, branches] = await Promise.all([
    prisma.category.findMany({
      where: { companyId: ahhas.id },
      select: { id: true, name: true },
    }),
    prisma.brand.findMany({
      where: { companyId: ahhas.id },
      select: { id: true, name: true },
    }),
    prisma.branch.findMany({
      where: { companyId: ahhas.id, isActive: true },
      select: { id: true, name: true, code: true },
    }),
  ]);
  const catMap = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
  const brandMap = new Map(brands.map((b) => [b.name.toLowerCase(), b.id]));

  // Get default rak per kategori (rak yang punya defaultForProducts dengan
  // categoryId tertentu, atau by location/name match).
  const racks = await prisma.rack.findMany({
    where: { companyId: ahhas.id },
    select: {
      id: true,
      code: true,
      name: true,
      branchId: true,
    },
  });

  // Map: kategori.name → rakId per branch.
  // Mapping: name match "Rak {Kategori}" → kategori
  const rackByCatBranch = new Map<string, string>(); // "branchId|catName" → rackId
  for (const r of racks) {
    const catName = r.name.replace(/^Rak\s+/i, "").trim();
    rackByCatBranch.set(`${r.branchId}|${catName.toLowerCase()}`, r.id);
  }

  let created = 0;
  let skipped = 0;
  let stockAdded = 0;

  for (const p of PRODUCTS) {
    const existing = await prisma.product.findFirst({
      where: { companyId: ahhas.id, code: p.code, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      console.log(`↷  ${p.code}: already exists — skip`);
      skipped++;
      continue;
    }

    const categoryId = catMap.get(p.categoryName.toLowerCase());
    if (!categoryId) {
      console.warn(`⚠️  ${p.code}: category "${p.categoryName}" not found — skip`);
      skipped++;
      continue;
    }
    const brandId = brandMap.get(p.brandName.toLowerCase()) ?? null;

    // Cari defaultRackId di branch pertama (HQ).
    const primaryBranch = branches[0];
    const defaultRackId = primaryBranch
      ? rackByCatBranch.get(
          `${primaryBranch.id}|${p.categoryName.toLowerCase()}`,
        ) ?? null
      : null;

    const product = await prisma.$transaction(async (tx) => {
      const newProd = await tx.product.create({
        data: {
          companyId: ahhas.id,
          code: p.code,
          name: p.name,
          categoryId,
          brandId,
          unit: p.unit,
          purchasePrice: p.purchasePrice,
          sellingPrice: p.sellingPrice,
          stock: p.initialStock,
          minStock: 5,
          isActive: true,
          ...(defaultRackId ? { defaultRackId } : {}),
          ...(p.description ? { description: p.description } : {}),
          ...(p.barcode ? { barcode: p.barcode } : {}),
        },
        select: { id: true },
      });

      // Create BranchStock + RackStock di tiap branch.
      for (const br of branches) {
        await tx.branchStock.create({
          data: {
            branchId: br.id,
            productId: newProd.id,
            quantity: p.initialStock,
            minStock: 5,
          },
        });

        const rackId =
          rackByCatBranch.get(`${br.id}|${p.categoryName.toLowerCase()}`) ?? null;
        if (rackId && p.initialStock > 0) {
          await tx.rackStock.create({
            data: {
              rackId,
              productId: newProd.id,
              branchId: br.id,
              qty: p.initialStock,
            },
          });
          await tx.rackStockMovement.create({
            data: {
              productId: newProd.id,
              branchId: br.id,
              toRackId: rackId,
              qty: p.initialStock,
              type: "MIGRATION",
              refType: "seed_ahhas_products",
              notes: "Seed produk awal Ahhas",
            },
          });
          stockAdded++;
        }
      }
      return newProd;
    });

    console.log(`✓  ${p.code}: ${p.name}`);
    created++;
    void product;
  }

  console.log("\n=== Summary ===");
  console.log(`Created    : ${created}`);
  console.log(`Skipped    : ${skipped}`);
  console.log(`RackStock  : ${stockAdded} entries`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
