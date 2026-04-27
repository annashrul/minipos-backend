import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Get existing references
  const categories = await prisma.category.findMany({ select: { id: true, name: true } });
  const brands = await prisma.brand.findMany({ select: { id: true, name: true } });
  const branches = await prisma.branch.findMany({ where: { isActive: true }, select: { id: true } });

  const catMap = Object.fromEntries(categories.map((c) => [c.name, c.id]));
  const brandMap = Object.fromEntries(brands.map((b) => [b.name, b.id]));

  // Create "Sembako" category if not exists
  let sembakoId = catMap["Sembako"];
  if (!sembakoId) {
    const cat = await prisma.category.create({ data: { name: "Sembako", description: "Bahan pokok dan sembilan bahan pokok" } });
    sembakoId = cat.id;
  }

  // Create "Gas & BBM" category if not exists
  let gasId = catMap["Gas & BBM"];
  if (!gasId) {
    const cat = await prisma.category.create({ data: { name: "Gas & BBM", description: "Gas LPG dan bahan bakar" } });
    gasId = cat.id;
  }

  // Helper to generate product code
  let counter = 900;
  const code = () => `PRD${String(++counter).padStart(4, "0")}`;

  // Wholesale products with multi-unit definitions
  const products = [
    {
      name: "Beras Premium 5kg",
      category: sembakoId,
      brand: null,
      unit: "Kg",
      purchasePrice: 12000,
      sellingPrice: 14000,
      stock: 500,
      minStock: 50,
      description: "Beras premium kualitas terbaik",
      units: [
        { name: "Karung (25 Kg)", conversionQty: 25, sellingPrice: 330000, purchasePrice: 290000 },
        { name: "Karung (50 Kg)", conversionQty: 50, sellingPrice: 640000, purchasePrice: 570000 },
      ],
    },
    {
      name: "Beras Medium",
      category: sembakoId,
      brand: null,
      unit: "Kg",
      purchasePrice: 10000,
      sellingPrice: 12000,
      stock: 800,
      minStock: 100,
      description: "Beras medium kualitas baik",
      units: [
        { name: "Karung (25 Kg)", conversionQty: 25, sellingPrice: 280000, purchasePrice: 240000 },
        { name: "Karung (50 Kg)", conversionQty: 50, sellingPrice: 550000, purchasePrice: 480000 },
        { name: "Liter", conversionQty: 1, sellingPrice: 12000, purchasePrice: 10000 },
      ],
    },
    {
      name: "Gula Pasir",
      category: sembakoId,
      brand: null,
      unit: "Kg",
      purchasePrice: 14000,
      sellingPrice: 16500,
      stock: 300,
      minStock: 30,
      description: "Gula pasir putih bersih",
      units: [
        { name: "Karung (50 Kg)", conversionQty: 50, sellingPrice: 790000, purchasePrice: 680000 },
        { name: "Pack (1 Kg)", conversionQty: 1, sellingPrice: 17000, purchasePrice: 14000 },
        { name: "Pack (500 gr)", conversionQty: 0.5, sellingPrice: 9000, purchasePrice: 7500 },
      ],
    },
    {
      name: "Minyak Goreng Bimoli",
      category: sembakoId,
      brand: brandMap["Bimoli"] || null,
      unit: "Liter",
      purchasePrice: 17000,
      sellingPrice: 19500,
      stock: 200,
      minStock: 20,
      description: "Minyak goreng berkualitas",
      units: [
        { name: "Jerigen (5 L)", conversionQty: 5, sellingPrice: 93000, purchasePrice: 82000 },
        { name: "Jerigen (18 L)", conversionQty: 18, sellingPrice: 320000, purchasePrice: 290000 },
        { name: "Dus (12 x 1L)", conversionQty: 12, sellingPrice: 224000, purchasePrice: 196000 },
      ],
    },
    {
      name: "Tepung Terigu Segitiga Biru",
      category: sembakoId,
      brand: null,
      unit: "Kg",
      purchasePrice: 10000,
      sellingPrice: 12500,
      stock: 400,
      minStock: 40,
      description: "Tepung terigu serbaguna",
      units: [
        { name: "Karung (25 Kg)", conversionQty: 25, sellingPrice: 295000, purchasePrice: 240000 },
        { name: "Pack (1 Kg)", conversionQty: 1, sellingPrice: 13000, purchasePrice: 10000 },
      ],
    },
    {
      name: "Telur Ayam",
      category: sembakoId,
      brand: null,
      unit: "Butir",
      purchasePrice: 2200,
      sellingPrice: 2700,
      stock: 1000,
      minStock: 100,
      description: "Telur ayam negeri segar",
      units: [
        { name: "Tray (30 Butir)", conversionQty: 30, sellingPrice: 75000, purchasePrice: 63000 },
        { name: "Peti (10 Tray / 300 Butir)", conversionQty: 300, sellingPrice: 720000, purchasePrice: 620000 },
        { name: "1/2 Kg (~8 Butir)", conversionQty: 8, sellingPrice: 20000, purchasePrice: 17000 },
      ],
    },
    {
      name: "Indomie Goreng",
      category: catMap["Makanan"] || sembakoId,
      brand: brandMap["Indofood"] || null,
      unit: "Pcs",
      purchasePrice: 2800,
      sellingPrice: 3500,
      stock: 2000,
      minStock: 200,
      description: "Mi instan goreng",
      units: [
        { name: "Dus (40 Pcs)", conversionQty: 40, sellingPrice: 128000, purchasePrice: 106000 },
        { name: "Renceng (5 Pcs)", conversionQty: 5, sellingPrice: 17000, purchasePrice: 13500 },
      ],
    },
    {
      name: "Indomie Kuah Soto",
      category: catMap["Makanan"] || sembakoId,
      brand: brandMap["Indofood"] || null,
      unit: "Pcs",
      purchasePrice: 2700,
      sellingPrice: 3300,
      stock: 1500,
      minStock: 200,
      description: "Mi instan kuah rasa soto",
      units: [
        { name: "Dus (40 Pcs)", conversionQty: 40, sellingPrice: 120000, purchasePrice: 102000 },
        { name: "Renceng (5 Pcs)", conversionQty: 5, sellingPrice: 16000, purchasePrice: 13000 },
      ],
    },
    {
      name: "Aqua Air Mineral",
      category: catMap["Minuman"] || sembakoId,
      brand: brandMap["Aqua"] || null,
      unit: "Botol",
      purchasePrice: 3500,
      sellingPrice: 5000,
      stock: 500,
      minStock: 50,
      description: "Air mineral 600ml",
      units: [
        { name: "Dus (24 Botol)", conversionQty: 24, sellingPrice: 96000, purchasePrice: 78000 },
        { name: "Pack (6 Botol)", conversionQty: 6, sellingPrice: 27000, purchasePrice: 20000 },
      ],
    },
    {
      name: "Aqua Galon 19L",
      category: catMap["Minuman"] || sembakoId,
      brand: brandMap["Aqua"] || null,
      unit: "Galon",
      purchasePrice: 16000,
      sellingPrice: 20000,
      stock: 50,
      minStock: 10,
      description: "Air mineral galon 19 liter",
      units: [],
    },
    {
      name: "Kecap Manis ABC",
      category: catMap["Bumbu & Dapur"] || sembakoId,
      brand: brandMap["ABC"] || null,
      unit: "Botol",
      purchasePrice: 12000,
      sellingPrice: 15000,
      stock: 100,
      minStock: 10,
      description: "Kecap manis 600ml",
      units: [
        { name: "Dus (12 Botol)", conversionQty: 12, sellingPrice: 168000, purchasePrice: 138000 },
        { name: "Sachet (14ml)", conversionQty: 0.02, sellingPrice: 500, purchasePrice: 350 },
      ],
    },
    {
      name: "Sabun Cuci Sunlight",
      category: catMap["Kebersihan"] || sembakoId,
      brand: brandMap["Unilever"] || null,
      unit: "Botol",
      purchasePrice: 11000,
      sellingPrice: 14000,
      stock: 150,
      minStock: 15,
      description: "Sabun cuci piring 800ml",
      units: [
        { name: "Dus (12 Botol)", conversionQty: 12, sellingPrice: 156000, purchasePrice: 126000 },
        { name: "Refill (700ml)", conversionQty: 1, sellingPrice: 12000, purchasePrice: 9500 },
      ],
    },
    {
      name: "Susu UHT Ultra Milk",
      category: catMap["Susu & Olahan"] || sembakoId,
      brand: brandMap["Ultramilk"] || null,
      unit: "Kotak",
      purchasePrice: 5500,
      sellingPrice: 7500,
      stock: 300,
      minStock: 30,
      description: "Susu UHT 1 Liter full cream",
      units: [
        { name: "Dus (12 Kotak)", conversionQty: 12, sellingPrice: 84000, purchasePrice: 63000 },
      ],
    },
    {
      name: "Rokok Sampoerna Mild",
      category: catMap["Rokok"] || sembakoId,
      brand: brandMap["Sampoerna"] || null,
      unit: "Bungkus",
      purchasePrice: 25000,
      sellingPrice: 28000,
      stock: 200,
      minStock: 20,
      description: "Rokok filter 16 batang",
      units: [
        { name: "Slop (10 Bungkus)", conversionQty: 10, sellingPrice: 270000, purchasePrice: 245000 },
        { name: "Bal (20 Slop / 200 Bungkus)", conversionQty: 200, sellingPrice: 5200000, purchasePrice: 4800000 },
        { name: "Batang", conversionQty: 0.0625, sellingPrice: 2000, purchasePrice: 1600 },
      ],
    },
    {
      name: "Rokok Gudang Garam Surya",
      category: catMap["Rokok"] || sembakoId,
      brand: brandMap["Gudang Garam"] || null,
      unit: "Bungkus",
      purchasePrice: 24000,
      sellingPrice: 27000,
      stock: 150,
      minStock: 20,
      description: "Rokok kretek 16 batang",
      units: [
        { name: "Slop (10 Bungkus)", conversionQty: 10, sellingPrice: 260000, purchasePrice: 235000 },
        { name: "Batang", conversionQty: 0.0625, sellingPrice: 1900, purchasePrice: 1550 },
      ],
    },
    {
      name: "Gas LPG 3 Kg",
      category: gasId,
      brand: null,
      unit: "Tabung",
      purchasePrice: 18000,
      sellingPrice: 22000,
      stock: 30,
      minStock: 5,
      description: "Gas LPG 3 Kg tabung hijau",
      units: [],
    },
    {
      name: "Sari Roti Tawar",
      category: catMap["Makanan"] || sembakoId,
      brand: brandMap["Sari Roti"] || null,
      unit: "Bungkus",
      purchasePrice: 13000,
      sellingPrice: 16000,
      stock: 100,
      minStock: 10,
      description: "Roti tawar panjang",
      units: [
        { name: "Dus (10 Bungkus)", conversionQty: 10, sellingPrice: 150000, purchasePrice: 125000 },
      ],
    },
    {
      name: "Kopi Kapal Api Special",
      category: catMap["Minuman"] || sembakoId,
      brand: brandMap["Kapal Api"] || null,
      unit: "Sachet",
      purchasePrice: 1200,
      sellingPrice: 2000,
      stock: 1000,
      minStock: 100,
      description: "Kopi bubuk sachet 25g",
      units: [
        { name: "Renceng (10 Sachet)", conversionQty: 10, sellingPrice: 18000, purchasePrice: 11500 },
        { name: "Dus (12 Renceng / 120 Sachet)", conversionQty: 120, sellingPrice: 200000, purchasePrice: 135000 },
      ],
    },
    {
      name: "Deterjen Rinso",
      category: catMap["Kebersihan"] || sembakoId,
      brand: brandMap["Unilever"] || null,
      unit: "Pack",
      purchasePrice: 2000,
      sellingPrice: 3000,
      stock: 500,
      minStock: 50,
      description: "Deterjen bubuk sachet 45g",
      units: [
        { name: "Renceng (6 Pack)", conversionQty: 6, sellingPrice: 16000, purchasePrice: 11000 },
        { name: "Dus (48 Pack)", conversionQty: 48, sellingPrice: 120000, purchasePrice: 90000 },
        { name: "Bag (900g)", conversionQty: 20, sellingPrice: 52000, purchasePrice: 38000 },
      ],
    },
    {
      name: "Garam Beryodium",
      category: catMap["Bumbu & Dapur"] || sembakoId,
      brand: null,
      unit: "Kg",
      purchasePrice: 5000,
      sellingPrice: 7000,
      stock: 200,
      minStock: 20,
      description: "Garam halus beryodium",
      units: [
        { name: "Karung (50 Kg)", conversionQty: 50, sellingPrice: 320000, purchasePrice: 240000 },
        { name: "Pack (250 gr)", conversionQty: 0.25, sellingPrice: 2500, purchasePrice: 1500 },
      ],
    },
  ];

  console.log(`Creating ${products.length} wholesale products...`);

  for (const p of products) {
    const productCode = code();

    // Check if product already exists by name
    const existing = await prisma.product.findFirst({ where: { name: p.name } });
    if (existing) {
      console.log(`  ⏭ Skipping "${p.name}" (already exists)`);

      // But still add units if they don't exist
      if (p.units.length > 0) {
        for (const u of p.units) {
          const existingUnit = await prisma.productUnit.findUnique({
            where: { productId_name: { productId: existing.id, name: u.name } },
          });
          if (!existingUnit) {
            await prisma.productUnit.create({
              data: {
                productId: existing.id,
                name: u.name,
                conversionQty: Math.round(u.conversionQty),
                sellingPrice: u.sellingPrice,
                purchasePrice: u.purchasePrice,
              },
            });
            console.log(`    + Unit "${u.name}" added to "${p.name}"`);
          }
        }
      }
      continue;
    }

    const product = await prisma.product.create({
      data: {
        code: productCode,
        name: p.name,
        categoryId: p.category,
        brandId: p.brand,
        unit: p.unit,
        purchasePrice: p.purchasePrice,
        sellingPrice: p.sellingPrice,
        stock: p.stock,
        minStock: p.minStock,
        description: p.description,
        isActive: true,
      },
    });

    // Create branch stocks
    for (const branch of branches) {
      await prisma.branchStock.upsert({
        where: { branchId_productId: { branchId: branch.id, productId: product.id } },
        update: {},
        create: { productId: product.id, branchId: branch.id, quantity: p.stock },
      });
    }

    // Create units
    if (p.units.length > 0) {
      for (let i = 0; i < p.units.length; i++) {
        const u = p.units[i]!;
        await prisma.productUnit.create({
          data: {
            productId: product.id,
            name: u.name,
            conversionQty: Math.max(1, Math.round(u.conversionQty)),
            sellingPrice: u.sellingPrice,
            purchasePrice: u.purchasePrice,
            sortOrder: i + 1,
          },
        });
      }
    }

    console.log(`  ✓ "${p.name}" (${p.unit}) + ${p.units.length} units`);
  }

  console.log("\nDone! Wholesale products created.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
