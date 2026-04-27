import type { PaymentMethod } from "@prisma/client";
import { PrismaClient, Role, StockMovementType } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const MENU_SEED = [
  {
    key: "dashboard",
    name: "Dashboard",
    path: "/dashboard",
    group: "Utama",
    sortOrder: 1,
    actions: ["view", "export"],
  },
  {
    key: "pos",
    name: "Kasir (POS)",
    path: "/pos",
    group: "Utama",
    sortOrder: 2,
    actions: [
      "view",
      "create",
      "void",
      "refund",
      "open_shift",
      "close_shift",
      "hold",
      "discount",
      "history",
      "reprint",
      "voucher",
      "redeem_points",
    ],
  },
  {
    key: "transactions",
    name: "Riwayat Transaksi",
    path: "/transactions",
    group: "Utama",
    sortOrder: 3,
    actions: ["view", "export", "void", "refund"],
  },
  {
    key: "shifts",
    name: "Shift Kasir",
    path: "/shifts",
    group: "Utama",
    sortOrder: 4,
    actions: ["view", "create", "update", "close_shift"],
  },
  {
    key: "products",
    name: "Produk",
    path: "/products",
    group: "Master Data",
    sortOrder: 1,
    actions: ["view", "create", "update", "delete", "export"],
  },
  {
    key: "bundles",
    name: "Paket Produk",
    path: "/bundles",
    group: "Master Data",
    sortOrder: 2,
    actions: ["view", "create", "update", "delete"],
  },
  {
    key: "categories",
    name: "Kategori",
    path: "/categories",
    group: "Master Data",
    sortOrder: 3,
    actions: ["view", "create", "update", "delete"],
  },
  {
    key: "brands",
    name: "Brand",
    path: "/brands",
    group: "Master Data",
    sortOrder: 3,
    actions: ["view", "create", "update", "delete"],
  },
  {
    key: "suppliers",
    name: "Supplier",
    path: "/suppliers",
    group: "Master Data",
    sortOrder: 4,
    actions: ["view", "create", "update", "delete"],
  },
  {
    key: "customers",
    name: "Customer",
    path: "/customers",
    group: "Master Data",
    sortOrder: 5,
    actions: ["view", "create", "update", "delete", "export"],
  },
  {
    key: "stock",
    name: "Manajemen Stok",
    path: "/stock",
    group: "Inventori",
    sortOrder: 1,
    actions: ["view", "create", "update", "export"],
  },
  {
    key: "purchases",
    name: "Purchase Order",
    path: "/purchases",
    group: "Inventori",
    sortOrder: 2,
    actions: ["view", "create", "update", "approve", "receive"],
  },
  {
    key: "stock-opname",
    name: "Stock Opname",
    path: "/stock-opname",
    group: "Inventori",
    sortOrder: 3,
    actions: ["view", "create", "update", "approve"],
  },
  {
    key: "stock-transfers",
    name: "Transfer Stok",
    path: "/stock-transfers",
    group: "Inventori",
    sortOrder: 4,
    actions: ["view", "create", "update", "approve", "receive"],
  },
  {
    key: "expenses",
    name: "Pengeluaran",
    path: "/expenses",
    group: "Keuangan",
    sortOrder: 1,
    actions: ["view", "create", "update", "delete", "export"],
  },
  {
    key: "promotions",
    name: "Promo",
    path: "/promotions",
    group: "Keuangan",
    sortOrder: 2,
    actions: ["view", "create", "update", "delete"],
  },
  {
    key: "debts",
    name: "Hutang Piutang",
    path: "/debts",
    group: "Keuangan",
    sortOrder: 3,
    actions: ["view", "create", "update", "delete"],
  },
  {
    key: "reports",
    name: "Laporan",
    path: "/reports",
    group: "Analitik",
    sortOrder: 1,
    actions: ["view", "export"],
  },
  {
    key: "analytics",
    name: "Business Intelligence",
    path: "/analytics",
    group: "Analitik",
    sortOrder: 2,
    actions: ["view", "export"],
  },
  {
    key: "customer-intelligence",
    name: "Customer Intel",
    path: "/customer-intelligence",
    group: "Analitik",
    sortOrder: 3,
    actions: ["view", "export"],
  },
  {
    key: "branches",
    name: "Cabang",
    path: "/branches",
    group: "Admin",
    sortOrder: 1,
    actions: ["view", "create", "update", "delete"],
  },
  {
    key: "branch-prices",
    name: "Harga Cabang",
    path: "/branch-prices",
    group: "Admin",
    sortOrder: 2,
    actions: ["view", "create", "update", "delete"],
  },
  {
    key: "audit-logs",
    name: "Audit Log",
    path: "/audit-logs",
    group: "Admin",
    sortOrder: 3,
    actions: ["view", "export"],
  },
  {
    key: "users",
    name: "Pengguna",
    path: "/users",
    group: "Admin",
    sortOrder: 4,
    actions: ["view", "create", "update", "delete"],
  },
  {
    key: "settings",
    name: "Pengaturan",
    path: "/settings",
    group: "Admin",
    sortOrder: 5,
    actions: ["view", "update"],
  },
  {
    key: "access-control",
    name: "Hak Akses",
    path: "/access-control",
    group: "Admin",
    sortOrder: 6,
    actions: ["view", "manage"],
  },
  {
    key: "tables",
    name: "Manajemen Meja",
    path: "/tables",
    group: "Admin",
    sortOrder: 7,
    actions: ["view", "create", "update", "delete"],
  },
  {
    key: "accounting",
    name: "Dashboard Akuntansi",
    path: "/accounting",
    group: "Akuntansi",
    sortOrder: 1,
    actions: ["view"],
  },
  {
    key: "accounting-coa",
    name: "Chart of Accounts",
    path: "/accounting/coa",
    group: "Akuntansi",
    sortOrder: 2,
    actions: ["view", "create", "update", "delete"],
  },
  {
    key: "accounting-journals",
    name: "Jurnal Umum",
    path: "/accounting/journals",
    group: "Akuntansi",
    sortOrder: 3,
    actions: ["view", "create", "update", "void"],
  },
  {
    key: "accounting-ledger",
    name: "Buku Besar",
    path: "/accounting/ledger",
    group: "Akuntansi",
    sortOrder: 4,
    actions: ["view", "export"],
  },
  {
    key: "accounting-reports",
    name: "Laporan Keuangan",
    path: "/accounting/reports",
    group: "Akuntansi",
    sortOrder: 5,
    actions: ["view", "export"],
  },
  {
    key: "accounting-periods",
    name: "Tutup Buku",
    path: "/accounting/periods",
    group: "Akuntansi",
    sortOrder: 6,
    actions: ["view", "create", "update"],
  },
] as const;

const MENU_ACCESS_BY_ROLE: Record<Role, string[]> = {
  SUPER_ADMIN: MENU_SEED.map((menu) => menu.key),
  ADMIN: MENU_SEED.map((menu) => menu.key).filter(
    (key) => key !== "audit-logs",
  ),
  MANAGER: [
    "dashboard",
    "pos",
    "transactions",
    "shifts",
    "products",
    "bundles",
    "categories",
    "brands",
    "suppliers",
    "customers",
    "stock",
    "purchases",
    "stock-opname",
    "stock-transfers",
    "expenses",
    "promotions",
    "debts",
    "reports",
    "analytics",
    "customer-intelligence",
    "accounting",
    "accounting-coa",
    "accounting-journals",
    "accounting-ledger",
    "accounting-reports",
    "accounting-periods",
    "tables",
  ],
  CASHIER: ["dashboard", "pos", "transactions", "shifts"],
};

async function main() {
  console.log("Seeding database...");

  // Clean existing data
  await prisma.activityLog.deleteMany();
  await prisma.journalEntryLine.deleteMany();
  await prisma.journalEntry.deleteMany();
  await prisma.accountingPeriod.deleteMany();
  await prisma.account.deleteMany();
  await prisma.accountCategory.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.roleActionPermission.deleteMany();
  await prisma.roleMenuPermission.deleteMany();
  await prisma.menuAction.deleteMany();
  await prisma.appMenu.deleteMany();
  await prisma.goodsReceiptItem.deleteMany();
  await prisma.goodsReceipt.deleteMany();
  await prisma.purchaseOrderItem.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.stockTransferItem.deleteMany();
  await prisma.stockTransfer.deleteMany();
  await prisma.stockOpnameItem.deleteMany();
  await prisma.stockOpname.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.cashMovement.deleteMany();
  await prisma.cashierShift.deleteMany();
  await prisma.refund.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.transactionItem.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.voucher.deleteMany();
  await prisma.promotion.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.supplierPayment.deleteMany();
  await prisma.customerPointHistory.deleteMany();
  await prisma.productUnit.deleteMany();
  await prisma.productBarcode.deleteMany();
  await prisma.productPriceHistory.deleteMany();
  await prisma.branchProductPrice.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  await prisma.brand.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.branch.deleteMany();
  await prisma.user.deleteMany();
  await prisma.company.deleteMany();
  await prisma.setting.deleteMany();
  await prisma.roleActionPermission.deleteMany();
  await prisma.roleMenuPermission.deleteMany();
  await prisma.menuAction.deleteMany();
  await prisma.appMenu.deleteMany();
  await prisma.appRole.deleteMany();

  // Create Demo Company
  const company = await prisma.company.create({
    data: {
      name: "Demo Store",
      slug: "demo-store",
      email: "admin@pos.com",
      phone: "021-1234567",
      address: "Jakarta, Indonesia",
    },
  });
  const companyId = company.id;

  // Create Users
  const hashedPassword = await bcrypt.hash("password123", 10);

  const admin = await prisma.user.create({
    data: {
      name: "Super Admin",
      email: "admin@pos.com",
      password: hashedPassword,
      role: Role.SUPER_ADMIN,
      companyId,
    },
  });

  const manager = await prisma.user.create({
    data: {
      name: "Manager Toko",
      email: "manager@pos.com",
      password: hashedPassword,
      role: Role.MANAGER,
      companyId,
    },
  });

  const cashier1 = await prisma.user.create({
    data: {
      name: "Kasir Satu",
      email: "kasir1@pos.com",
      password: hashedPassword,
      role: Role.CASHIER,
      companyId,
    },
  });

  const cashier2 = await prisma.user.create({
    data: {
      name: "Kasir Dua",
      email: "kasir2@pos.com",
      password: hashedPassword,
      role: Role.CASHIER,
      companyId,
    },
  });

  for (const menu of MENU_SEED) {
    const createdMenu = await prisma.appMenu.create({
      data: {
        key: menu.key,
        name: menu.name,
        path: menu.path,
        group: menu.group,
        sortOrder: menu.sortOrder,
      },
    });

    for (let index = 0; index < menu.actions.length; index += 1) {
      const actionKey = menu.actions[index];
      const action = await prisma.menuAction.create({
        data: {
          menuId: createdMenu.id,
          key: actionKey,
          name: actionKey.toUpperCase(),
          sortOrder: index + 1,
        },
      });

      for (const role of Object.values(Role)) {
        const isMenuAllowed = MENU_ACCESS_BY_ROLE[role].includes(menu.key);
        await prisma.roleActionPermission.create({
          data: {
            role,
            menuActionId: action.id,
            allowed: isMenuAllowed,
          },
        });
      }
    }

    for (const role of Object.values(Role)) {
      const isMenuAllowed = MENU_ACCESS_BY_ROLE[role].includes(menu.key);
      await prisma.roleMenuPermission.create({
        data: {
          role,
          menuId: createdMenu.id,
          allowed: isMenuAllowed,
        },
      });
    }
  }

  // Create Brands
  const brands = await Promise.all([
    prisma.brand.create({ data: { name: "Indofood", companyId } }),
    prisma.brand.create({ data: { name: "Coca-Cola", companyId } }),
    prisma.brand.create({ data: { name: "Unilever", companyId } }),
    prisma.brand.create({ data: { name: "Faber-Castell", companyId } }),
    prisma.brand.create({ data: { name: "Wings", companyId } }),
    prisma.brand.create({ data: { name: "Aqua", companyId } }),       // 5
    prisma.brand.create({ data: { name: "Mayora", companyId } }),      // 6
    prisma.brand.create({ data: { name: "Mondelez", companyId } }),    // 7
    prisma.brand.create({ data: { name: "Glico", companyId } }),       // 8
    prisma.brand.create({ data: { name: "SC Johnson", companyId } }),  // 9
    prisma.brand.create({ data: { name: "P&G", companyId } }),         // 10
    prisma.brand.create({ data: { name: "Sidu", companyId } }),        // 11
    prisma.brand.create({ data: { name: "Staedtler", companyId } }),   // 12
    prisma.brand.create({ data: { name: "Sosro", companyId } }),       // 13
    prisma.brand.create({ data: { name: "Garudafood", companyId } }),  // 14
    prisma.brand.create({ data: { name: "ABC", companyId } }),         // 15
    prisma.brand.create({ data: { name: "Frisian Flag", companyId } }),// 16
    prisma.brand.create({ data: { name: "Kapal Api", companyId } }),   // 17
    prisma.brand.create({ data: { name: "Nestle", companyId } }),      // 18
    prisma.brand.create({ data: { name: "Kalbe", companyId } }),       // 19
    prisma.brand.create({ data: { name: "Kimia Farma", companyId } }), // 20
    prisma.brand.create({ data: { name: "Sasa", companyId } }),        // 21
    prisma.brand.create({ data: { name: "Bimoli", companyId } }),      // 22
    prisma.brand.create({ data: { name: "So Good", companyId } }),     // 23
    prisma.brand.create({ data: { name: "Orang Tua", companyId } }),   // 24
    prisma.brand.create({ data: { name: "Ajinomoto", companyId } }),   // 25
    prisma.brand.create({ data: { name: "Wardah", companyId } }),      // 26
    prisma.brand.create({ data: { name: "Mie Sedaap", companyId } }),  // 27
    prisma.brand.create({ data: { name: "Sari Roti", companyId } }),   // 28
    prisma.brand.create({ data: { name: "Ultramilk", companyId } }),   // 29
  ]);

  // Create Suppliers
  const suppliers = await Promise.all([
    prisma.supplier.create({
      data: {
        name: "PT Indofood Sukses Makmur",
        contact: "021-5555-1234",
        email: "order@indofood.co.id",
        address: "Jakarta",
        companyId,
      },
    }),
    prisma.supplier.create({
      data: {
        name: "PT Coca-Cola Indonesia",
        contact: "021-5555-5678",
        email: "order@coca-cola.co.id",
        address: "Bekasi",
        companyId,
      },
    }),
    prisma.supplier.create({
      data: {
        name: "PT Unilever Indonesia",
        contact: "021-5555-9012",
        email: "order@unilever.co.id",
        address: "Tangerang",
        companyId,
      },
    }),
  ]);

  // Create Customers
  await Promise.all([
    prisma.customer.create({
      data: {
        name: "Budi Santoso",
        phone: "08123456789",
        email: "budi@email.com",
        memberLevel: "GOLD",
        totalSpending: 2500000,
        points: 250,
        companyId,
      },
    }),
    prisma.customer.create({
      data: {
        name: "Siti Rahayu",
        phone: "08234567890",
        email: "siti@email.com",
        memberLevel: "SILVER",
        totalSpending: 1200000,
        points: 120,
        companyId,
      },
    }),
    prisma.customer.create({
      data: {
        name: "Ahmad Wijaya",
        phone: "08345678901",
        memberLevel: "REGULAR",
        totalSpending: 350000,
        points: 35,
        companyId,
      },
    }),
  ]);

  // Create Branches
  const branchRecords = await Promise.all([
    prisma.branch.create({
      data: {
        name: "Pusat - Jakarta",
        address: "Jl. Sudirman No. 1, Jakarta",
        phone: "021-1234567",
        companyId,
      },
    }),
    prisma.branch.create({
      data: {
        name: "Cabang Bandung",
        address: "Jl. Asia Afrika No. 10, Bandung",
        phone: "022-1234567",
        companyId,
      },
    }),
    prisma.branch.create({
      data: {
        name: "Cabang Surabaya",
        address: "Jl. Tunjungan No. 5, Surabaya",
        phone: "031-1234567",
        companyId,
      },
    }),
  ]);

  // Create Categories
  const categories = await Promise.all([
    prisma.category.create({
      data: { name: "Makanan", description: "Produk makanan ringan dan berat", companyId },
    }),
    prisma.category.create({
      data: { name: "Minuman", description: "Produk minuman kemasan dan segar", companyId },
    }),
    prisma.category.create({
      data: { name: "Snack", description: "Makanan ringan dan cemilan", companyId },
    }),
    prisma.category.create({
      data: { name: "Kebersihan", description: "Produk kebersihan rumah tangga", companyId },
    }),
    prisma.category.create({
      data: { name: "Perawatan Tubuh", description: "Sabun, shampoo, dan lainnya", companyId },
    }),
    prisma.category.create({
      data: { name: "Alat Tulis", description: "Perlengkapan alat tulis kantor", companyId },
    }),
    prisma.category.create({
      data: { name: "Rokok", description: "Produk tembakau dan rokok", companyId },
    }),
    prisma.category.create({
      data: { name: "Bumbu & Dapur", description: "Bumbu masak dan kebutuhan dapur", companyId },
    }),
    prisma.category.create({
      data: { name: "Susu & Olahan", description: "Susu, keju, yogurt", companyId },
    }),
    prisma.category.create({
      data: { name: "Frozen Food", description: "Makanan beku siap saji", companyId },
    }),
    prisma.category.create({
      data: { name: "Obat & Kesehatan", description: "Obat-obatan dan suplemen", companyId },
    }),
  ]);

  // Extra brands & suppliers for tobacco
  const brandSampoerna = await prisma.brand.create({
    data: { name: "Sampoerna", companyId },
  });
  const brandGudangGaram = await prisma.brand.create({
    data: { name: "Gudang Garam", companyId },
  });
  const brandDjarum = await prisma.brand.create({ data: { name: "Djarum", companyId } });
  const supplierTobacco = await prisma.supplier.create({
    data: {
      name: "PT Distributor Tembakau Nusantara",
      contact: "021-7777-1234",
      email: "order@dtn.co.id",
      address: "Jakarta",
      companyId,
    },
  });

  // Helper: product placeholder image
  const productImage = (name: string, bg = "e2e8f0", fg = "334155") =>
    `https://placehold.co/400x400/${bg}/${fg}/png?text=${encodeURIComponent(name.replace(/ /g, "\\n"))}`;

  // Create Products
  const productsData = [
    {
      code: "PRD001",
      name: "Indomie Goreng",
      categoryId: categories[0].id,
      brandId: brands[0].id,
      supplierId: suppliers[0].id,
      purchasePrice: 2500,
      sellingPrice: 3500,
      stock: 100,
      barcode: "8886008101053",
      unit: "pcs",
      imageUrl: productImage("Indomie\\nGoreng", "fef3c7", "92400e"),
    },
    {
      code: "PRD002",
      name: "Indomie Soto",
      categoryId: categories[0].id,
      brandId: brands[0].id,
      supplierId: suppliers[0].id,
      purchasePrice: 2500,
      sellingPrice: 3500,
      stock: 80,
      barcode: "8886008101060",
      unit: "pcs",
      imageUrl: productImage("Indomie\\nSoto", "fef3c7", "92400e"),
    },
    {
      code: "PRD003",
      name: "Nasi Goreng Instan",
      categoryId: categories[0].id,
      brandId: brands[0].id,
      supplierId: suppliers[0].id,
      purchasePrice: 3000,
      sellingPrice: 4500,
      stock: 50,
      barcode: "8886008101077",
      unit: "pcs",
      imageUrl: productImage("Nasi Goreng\\nInstan", "fef3c7", "92400e"),
    },
    {
      code: "PRD004",
      name: "Aqua 600ml",
      categoryId: categories[1].id,
      brandId: brands[5].id,
      purchasePrice: 2000,
      sellingPrice: 3000,
      stock: 200,
      barcode: "8886008101084",
      unit: "botol",
      imageUrl: productImage("Aqua\\n600ml", "dbeafe", "1e3a5f"),
    },
    {
      code: "PRD005",
      name: "Coca Cola 330ml",
      categoryId: categories[1].id,
      brandId: brands[1].id,
      supplierId: suppliers[1].id,
      purchasePrice: 4000,
      sellingPrice: 6000,
      stock: 60,
      barcode: "8886008101091",
      unit: "kaleng",
      imageUrl: productImage("Coca Cola\\n330ml", "fecaca", "991b1b"),
    },
    {
      code: "PRD006",
      name: "Teh Pucuk 350ml",
      categoryId: categories[1].id,
      brandId: brands[6].id,
      purchasePrice: 2500,
      sellingPrice: 4000,
      stock: 90,
      barcode: "8886008101107",
      unit: "botol",
      imageUrl: productImage("Teh Pucuk\\n350ml", "d1fae5", "065f46"),
    },
    {
      code: "PRD007",
      name: "Chitato Original 68g",
      categoryId: categories[2].id,
      brandId: brands[0].id,
      supplierId: suppliers[0].id,
      purchasePrice: 7000,
      sellingPrice: 10000,
      stock: 40,
      barcode: "8886008101114",
      unit: "pcs",
      imageUrl: productImage("Chitato\\nOriginal", "fef9c3", "854d0e"),
    },
    {
      code: "PRD008",
      name: "Oreo 137g",
      categoryId: categories[2].id,
      brandId: brands[7].id,
      purchasePrice: 8000,
      sellingPrice: 12000,
      stock: 35,
      barcode: "8886008101121",
      unit: "pcs",
      imageUrl: productImage("Oreo\\n137g", "1e293b", "f1f5f9"),
    },
    {
      code: "PRD009",
      name: "Pocky Chocolate",
      categoryId: categories[2].id,
      brandId: brands[8].id,
      purchasePrice: 6000,
      sellingPrice: 9000,
      stock: 45,
      barcode: "8886008101138",
      unit: "pcs",
      imageUrl: productImage("Pocky\\nChocolate", "fce7f3", "9d174d"),
    },
    {
      code: "PRD010",
      name: "Sunlight 400ml",
      categoryId: categories[3].id,
      brandId: brands[2].id,
      supplierId: suppliers[2].id,
      purchasePrice: 5000,
      sellingPrice: 7500,
      stock: 30,
      barcode: "8886008101145",
      unit: "botol",
      imageUrl: productImage("Sunlight\\n400ml", "fef9c3", "854d0e"),
    },
    {
      code: "PRD011",
      name: "Rinso 800g",
      categoryId: categories[3].id,
      brandId: brands[2].id,
      supplierId: suppliers[2].id,
      purchasePrice: 12000,
      sellingPrice: 16000,
      stock: 25,
      barcode: "8886008101152",
      unit: "pcs",
      imageUrl: productImage("Rinso\\n800g", "dbeafe", "1e3a5f"),
    },
    {
      code: "PRD012",
      name: "Baygon Aerosol",
      categoryId: categories[3].id,
      brandId: brands[9].id,
      purchasePrice: 25000,
      sellingPrice: 32000,
      stock: 15,
      barcode: "8886008101169",
      unit: "pcs",
      imageUrl: productImage("Baygon\\nAerosol", "d1fae5", "065f46"),
    },
    {
      code: "PRD013",
      name: "Lifebuoy Sabun Mandi",
      categoryId: categories[4].id,
      brandId: brands[2].id,
      supplierId: suppliers[2].id,
      purchasePrice: 3000,
      sellingPrice: 4500,
      stock: 50,
      barcode: "8886008101176",
      unit: "pcs",
      imageUrl: productImage("Lifebuoy\\nSabun", "fecaca", "991b1b"),
    },
    {
      code: "PRD014",
      name: "Shampoo Pantene 160ml",
      categoryId: categories[4].id,
      brandId: brands[10].id,
      supplierId: suppliers[2].id,
      purchasePrice: 15000,
      sellingPrice: 22000,
      stock: 20,
      barcode: "8886008101183",
      unit: "botol",
      imageUrl: productImage("Pantene\\n160ml", "ede9fe", "5b21b6"),
    },
    {
      code: "PRD015",
      name: "Pasta Gigi Pepsodent",
      categoryId: categories[4].id,
      brandId: brands[2].id,
      supplierId: suppliers[2].id,
      purchasePrice: 5000,
      sellingPrice: 8000,
      stock: 40,
      barcode: "8886008101190",
      unit: "pcs",
      imageUrl: productImage("Pepsodent", "dbeafe", "1e3a5f"),
    },
    {
      code: "PRD016",
      name: "Pensil 2B Faber",
      categoryId: categories[5].id,
      brandId: brands[3].id,
      purchasePrice: 2000,
      sellingPrice: 3500,
      stock: 100,
      barcode: "8886008101206",
      unit: "pcs",
      imageUrl: productImage("Pensil 2B\\nFaber", "e2e8f0", "334155"),
    },
    {
      code: "PRD017",
      name: "Buku Tulis 58 Lembar",
      categoryId: categories[5].id,
      brandId: brands[11].id,
      purchasePrice: 3000,
      sellingPrice: 5000,
      stock: 3,
      barcode: "8886008101213",
      unit: "pcs",
      imageUrl: productImage("Buku Tulis\\n58 Lbr", "e2e8f0", "334155"),
    },
    {
      code: "PRD018",
      name: "Penghapus Staedtler",
      categoryId: categories[5].id,
      brandId: brands[12].id,
      purchasePrice: 2000,
      sellingPrice: 4000,
      stock: 2,
      barcode: "8886008101220",
      unit: "pcs",
      imageUrl: productImage("Penghapus\\nStaedtler", "e2e8f0", "334155"),
    },
    {
      code: "PRD019",
      name: "Teh Botol Sosro 450ml",
      categoryId: categories[1].id,
      brandId: brands[13].id,
      purchasePrice: 3000,
      sellingPrice: 5000,
      stock: 70,
      barcode: "8886008101237",
      unit: "botol",
      imageUrl: productImage("Teh Sosro\\n450ml", "d1fae5", "065f46"),
    },
    {
      code: "PRD020",
      name: "Good Day Cappucino",
      categoryId: categories[1].id,
      brandId: brands[14].id,
      purchasePrice: 3500,
      sellingPrice: 5500,
      stock: 55,
      barcode: "8886008101244",
      unit: "botol",
      imageUrl: productImage("Good Day\\nCappucino", "fef3c7", "92400e"),
    },
    // === PRD021-030: Makanan ===
    { code: "PRD021", name: "Mie Sedaap Goreng", categoryId: categories[0].id, brandId: brands[27].id, purchasePrice: 2500, sellingPrice: 3500, stock: 120, barcode: "8886008102001", unit: "pcs", imageUrl: productImage("Mie Sedaap\\nGoreng", "fef3c7", "92400e") },
    { code: "PRD022", name: "Mie Sedaap Soto", categoryId: categories[0].id, brandId: brands[27].id, purchasePrice: 2500, sellingPrice: 3500, stock: 90, barcode: "8886008102002", unit: "pcs", imageUrl: productImage("Mie Sedaap\\nSoto", "fef3c7", "92400e") },
    { code: "PRD023", name: "Sari Roti Tawar", categoryId: categories[0].id, brandId: brands[28].id, purchasePrice: 10000, sellingPrice: 14000, stock: 30, barcode: "8886008102003", unit: "pcs", imageUrl: productImage("Sari Roti\\nTawar", "fef3c7", "92400e") },
    { code: "PRD024", name: "Sari Roti Coklat", categoryId: categories[0].id, brandId: brands[28].id, purchasePrice: 3000, sellingPrice: 4500, stock: 40, barcode: "8886008102004", unit: "pcs", imageUrl: productImage("Sari Roti\\nCoklat", "fef3c7", "92400e") },
    { code: "PRD025", name: "Kopi Kapal Api Special", categoryId: categories[0].id, brandId: brands[17].id, purchasePrice: 1000, sellingPrice: 2000, stock: 200, barcode: "8886008102005", unit: "sachet", imageUrl: productImage("Kapal Api\\nSpecial", "fef3c7", "92400e") },
    { code: "PRD026", name: "Kopi ABC Susu", categoryId: categories[0].id, brandId: brands[15].id, purchasePrice: 1200, sellingPrice: 2500, stock: 180, barcode: "8886008102006", unit: "sachet", imageUrl: productImage("ABC Susu\\nKopi", "fef3c7", "92400e") },
    { code: "PRD027", name: "Nescafe Classic Sachet", categoryId: categories[0].id, brandId: brands[18].id, purchasePrice: 1500, sellingPrice: 2500, stock: 150, barcode: "8886008102007", unit: "sachet", imageUrl: productImage("Nescafe\\nClassic", "fef3c7", "92400e") },
    { code: "PRD028", name: "Pop Mie Ayam", categoryId: categories[0].id, brandId: brands[0].id, purchasePrice: 4000, sellingPrice: 6000, stock: 60, barcode: "8886008102008", unit: "pcs", imageUrl: productImage("Pop Mie\\nAyam", "fef3c7", "92400e") },
    { code: "PRD029", name: "Supermi Ayam Bawang", categoryId: categories[0].id, brandId: brands[0].id, purchasePrice: 2000, sellingPrice: 3000, stock: 100, barcode: "8886008102009", unit: "pcs", imageUrl: productImage("Supermi\\nAyam Bawang", "fef3c7", "92400e") },
    { code: "PRD030", name: "Sarimi Isi 2 Ayam", categoryId: categories[0].id, brandId: brands[0].id, purchasePrice: 2500, sellingPrice: 3500, stock: 80, barcode: "8886008102010", unit: "pcs", imageUrl: productImage("Sarimi\\nIsi 2", "fef3c7", "92400e") },
    // === PRD031-045: Minuman ===
    { code: "PRD031", name: "Sprite 390ml", categoryId: categories[1].id, brandId: brands[1].id, purchasePrice: 3500, sellingPrice: 5500, stock: 72, barcode: "8886008102011", unit: "botol", imageUrl: productImage("Sprite\\n390ml", "d1fae5", "065f46") },
    { code: "PRD032", name: "Fanta Strawberry 390ml", categoryId: categories[1].id, brandId: brands[1].id, purchasePrice: 3500, sellingPrice: 5500, stock: 60, barcode: "8886008102012", unit: "botol", imageUrl: productImage("Fanta\\nStrawberry", "fecaca", "991b1b") },
    { code: "PRD033", name: "Aqua 1500ml", categoryId: categories[1].id, brandId: brands[5].id, purchasePrice: 3500, sellingPrice: 5000, stock: 100, barcode: "8886008102013", unit: "botol", imageUrl: productImage("Aqua\\n1500ml", "dbeafe", "1e3a5f") },
    { code: "PRD034", name: "Aqua 330ml", categoryId: categories[1].id, brandId: brands[5].id, purchasePrice: 1000, sellingPrice: 2000, stock: 240, barcode: "8886008102014", unit: "botol", imageUrl: productImage("Aqua\\n330ml", "dbeafe", "1e3a5f") },
    { code: "PRD035", name: "Pocari Sweat 500ml", categoryId: categories[1].id, brandId: brands[8].id, purchasePrice: 5000, sellingPrice: 7500, stock: 48, barcode: "8886008102015", unit: "botol", imageUrl: productImage("Pocari\\nSweat", "dbeafe", "1e3a5f") },
    { code: "PRD036", name: "Mizone Lychee 500ml", categoryId: categories[1].id, brandId: brands[5].id, purchasePrice: 3500, sellingPrice: 5500, stock: 60, barcode: "8886008102016", unit: "botol", imageUrl: productImage("Mizone\\nLychee", "dbeafe", "1e3a5f") },
    { code: "PRD037", name: "Teh Kotak Jasmine 300ml", categoryId: categories[1].id, brandId: brands[29].id, purchasePrice: 2500, sellingPrice: 4000, stock: 80, barcode: "8886008102017", unit: "pcs", imageUrl: productImage("Teh Kotak\\n300ml", "d1fae5", "065f46") },
    { code: "PRD038", name: "Floridina Orange 350ml", categoryId: categories[1].id, brandId: brands[4].id, purchasePrice: 3000, sellingPrice: 5000, stock: 60, barcode: "8886008102018", unit: "botol", imageUrl: productImage("Floridina\\nOrange", "fef9c3", "854d0e") },
    { code: "PRD039", name: "Le Minerale 600ml", categoryId: categories[1].id, brandId: brands[6].id, purchasePrice: 2000, sellingPrice: 3000, stock: 150, barcode: "8886008102019", unit: "botol", imageUrl: productImage("Le Minerale\\n600ml", "dbeafe", "1e3a5f") },
    { code: "PRD040", name: "Yakult Original", categoryId: categories[1].id, brandId: brands[18].id, purchasePrice: 2000, sellingPrice: 3000, stock: 80, barcode: "8886008102020", unit: "botol", imageUrl: productImage("Yakult\\nOriginal", "fecaca", "991b1b") },
    { code: "PRD041", name: "Nutrisari Jeruk Sachet", categoryId: categories[1].id, brandId: brands[18].id, purchasePrice: 800, sellingPrice: 1500, stock: 200, barcode: "8886008102021", unit: "sachet", imageUrl: productImage("Nutrisari\\nJeruk", "fef9c3", "854d0e") },
    { code: "PRD042", name: "Frestea Jasmine 350ml", categoryId: categories[1].id, brandId: brands[1].id, purchasePrice: 2500, sellingPrice: 4000, stock: 72, barcode: "8886008102022", unit: "botol", imageUrl: productImage("Frestea\\n350ml", "d1fae5", "065f46") },
    { code: "PRD043", name: "Ultra Milk Coklat 250ml", categoryId: categories[1].id, brandId: brands[29].id, purchasePrice: 4500, sellingPrice: 6500, stock: 48, barcode: "8886008102023", unit: "pcs", imageUrl: productImage("Ultra Milk\\nCoklat", "fef3c7", "92400e") },
    { code: "PRD044", name: "Teh Gelas 180ml", categoryId: categories[1].id, brandId: brands[24].id, purchasePrice: 1000, sellingPrice: 2000, stock: 120, barcode: "8886008102024", unit: "pcs", imageUrl: productImage("Teh Gelas\\n180ml", "d1fae5", "065f46") },
    { code: "PRD045", name: "Fruit Tea Apple 350ml", categoryId: categories[1].id, brandId: brands[13].id, purchasePrice: 3000, sellingPrice: 5000, stock: 60, barcode: "8886008102025", unit: "botol", imageUrl: productImage("Fruit Tea\\nApple", "fecaca", "991b1b") },
    // === PRD046-060: Snack ===
    { code: "PRD046", name: "Taro Net BBQ 36g", categoryId: categories[2].id, brandId: brands[0].id, purchasePrice: 3000, sellingPrice: 5000, stock: 60, barcode: "8886008102026", unit: "pcs", imageUrl: productImage("Taro Net\\nBBQ", "fef9c3", "854d0e") },
    { code: "PRD047", name: "Lays Rumput Laut 68g", categoryId: categories[2].id, brandId: brands[0].id, purchasePrice: 7000, sellingPrice: 10000, stock: 36, barcode: "8886008102027", unit: "pcs", imageUrl: productImage("Lays\\nRumput Laut", "d1fae5", "065f46") },
    { code: "PRD048", name: "Cheetos Jagung Bakar", categoryId: categories[2].id, brandId: brands[0].id, purchasePrice: 5000, sellingPrice: 7500, stock: 40, barcode: "8886008102028", unit: "pcs", imageUrl: productImage("Cheetos\\nJagung", "fef9c3", "854d0e") },
    { code: "PRD049", name: "Biskuit Roma Kelapa", categoryId: categories[2].id, brandId: brands[6].id, purchasePrice: 3000, sellingPrice: 5000, stock: 50, barcode: "8886008102029", unit: "pcs", imageUrl: productImage("Roma\\nKelapa", "fef3c7", "92400e") },
    { code: "PRD050", name: "Wafer Tango Coklat", categoryId: categories[2].id, brandId: brands[24].id, purchasePrice: 4000, sellingPrice: 6500, stock: 45, barcode: "8886008102030", unit: "pcs", imageUrl: productImage("Tango\\nCoklat", "1e293b", "f1f5f9") },
    { code: "PRD051", name: "Beng Beng Maxx", categoryId: categories[2].id, brandId: brands[6].id, purchasePrice: 3500, sellingPrice: 5000, stock: 60, barcode: "8886008102031", unit: "pcs", imageUrl: productImage("Beng Beng\\nMaxx", "fce7f3", "9d174d") },
    { code: "PRD052", name: "Silverqueen Chunky Bar", categoryId: categories[2].id, brandId: brands[14].id, purchasePrice: 8000, sellingPrice: 12000, stock: 30, barcode: "8886008102032", unit: "pcs", imageUrl: productImage("Silverqueen\\nChunky", "ede9fe", "5b21b6") },
    { code: "PRD053", name: "Permen Kopiko", categoryId: categories[2].id, brandId: brands[6].id, purchasePrice: 500, sellingPrice: 1000, stock: 200, barcode: "8886008102033", unit: "pcs", imageUrl: productImage("Kopiko\\nPermen", "1e293b", "f1f5f9") },
    { code: "PRD054", name: "Kacang Garuda Rasa Bawang", categoryId: categories[2].id, brandId: brands[14].id, purchasePrice: 5000, sellingPrice: 8000, stock: 40, barcode: "8886008102034", unit: "pcs", imageUrl: productImage("Garuda\\nBawang", "fef9c3", "854d0e") },
    { code: "PRD055", name: "Richeese Nabati Keju", categoryId: categories[2].id, brandId: brands[18].id, purchasePrice: 2000, sellingPrice: 3500, stock: 80, barcode: "8886008102035", unit: "pcs", imageUrl: productImage("Nabati\\nKeju", "fef9c3", "854d0e") },
    { code: "PRD056", name: "Permen Relaxa", categoryId: categories[2].id, brandId: brands[24].id, purchasePrice: 500, sellingPrice: 1000, stock: 150, barcode: "8886008102036", unit: "pcs", imageUrl: productImage("Relaxa", "dbeafe", "1e3a5f") },
    { code: "PRD057", name: "Potabee Ayam BBQ 68g", categoryId: categories[2].id, brandId: brands[14].id, purchasePrice: 7000, sellingPrice: 10000, stock: 36, barcode: "8886008102037", unit: "pcs", imageUrl: productImage("Potabee\\nAyam BBQ", "fecaca", "991b1b") },
    { code: "PRD058", name: "Qtela Tempe Original", categoryId: categories[2].id, brandId: brands[0].id, purchasePrice: 5000, sellingPrice: 8000, stock: 40, barcode: "8886008102038", unit: "pcs", imageUrl: productImage("Qtela\\nTempe", "d1fae5", "065f46") },
    { code: "PRD059", name: "Tic Tac Grape", categoryId: categories[2].id, brandId: brands[18].id, purchasePrice: 3000, sellingPrice: 5000, stock: 50, barcode: "8886008102039", unit: "pcs", imageUrl: productImage("Tic Tac\\nGrape", "ede9fe", "5b21b6") },
    { code: "PRD060", name: "Sari Gandum Sandwich", categoryId: categories[2].id, brandId: brands[14].id, purchasePrice: 2000, sellingPrice: 3500, stock: 60, barcode: "8886008102040", unit: "pcs", imageUrl: productImage("Sari Gandum\\nSandwich", "fef3c7", "92400e") },
    // === PRD061-070: Kebersihan ===
    { code: "PRD061", name: "Molto Pewangi 800ml", categoryId: categories[3].id, brandId: brands[2].id, purchasePrice: 12000, sellingPrice: 16000, stock: 20, barcode: "8886008102041", unit: "pcs", imageUrl: productImage("Molto\\nPewangi", "ede9fe", "5b21b6") },
    { code: "PRD062", name: "Super Pell Lavender 770ml", categoryId: categories[3].id, brandId: brands[4].id, purchasePrice: 9000, sellingPrice: 13000, stock: 25, barcode: "8886008102042", unit: "botol", imageUrl: productImage("Super Pell\\nLavender", "ede9fe", "5b21b6") },
    { code: "PRD063", name: "Wipol Karbol 800ml", categoryId: categories[3].id, brandId: brands[2].id, purchasePrice: 8000, sellingPrice: 12000, stock: 20, barcode: "8886008102043", unit: "botol", imageUrl: productImage("Wipol\\nKarbol", "d1fae5", "065f46") },
    { code: "PRD064", name: "SOS Pembersih Lantai 750ml", categoryId: categories[3].id, brandId: brands[4].id, purchasePrice: 10000, sellingPrice: 14000, stock: 18, barcode: "8886008102044", unit: "botol", imageUrl: productImage("SOS\\nLantai", "dbeafe", "1e3a5f") },
    { code: "PRD065", name: "Mama Lemon 400ml", categoryId: categories[3].id, brandId: brands[4].id, purchasePrice: 6000, sellingPrice: 9000, stock: 30, barcode: "8886008102045", unit: "botol", imageUrl: productImage("Mama Lemon\\n400ml", "fef9c3", "854d0e") },
    { code: "PRD066", name: "Soklin Lantai 900ml", categoryId: categories[3].id, brandId: brands[4].id, purchasePrice: 7000, sellingPrice: 10000, stock: 22, barcode: "8886008102046", unit: "botol", imageUrl: productImage("Soklin\\nLantai", "dbeafe", "1e3a5f") },
    { code: "PRD067", name: "Hit Obat Nyamuk Spray", categoryId: categories[3].id, brandId: brands[9].id, purchasePrice: 20000, sellingPrice: 28000, stock: 12, barcode: "8886008102047", unit: "pcs", imageUrl: productImage("Hit\\nSpray", "d1fae5", "065f46") },
    { code: "PRD068", name: "Tisu Paseo 250 Sheet", categoryId: categories[3].id, brandId: brands[24].id, purchasePrice: 10000, sellingPrice: 14000, stock: 30, barcode: "8886008102048", unit: "pcs", imageUrl: productImage("Paseo\\n250 Sheet", "e2e8f0", "334155") },
    { code: "PRD069", name: "Softex Comfort Slim", categoryId: categories[3].id, brandId: brands[2].id, purchasePrice: 7000, sellingPrice: 10000, stock: 25, barcode: "8886008102049", unit: "pcs", imageUrl: productImage("Softex\\nSlim", "fce7f3", "9d174d") },
    { code: "PRD070", name: "Trash Bag Kresek Hitam", categoryId: categories[3].id, brandId: brands[4].id, purchasePrice: 5000, sellingPrice: 8000, stock: 40, barcode: "8886008102050", unit: "pack", imageUrl: productImage("Kresek\\nHitam", "1e293b", "f1f5f9") },
    // === PRD071-080: Perawatan Tubuh ===
    { code: "PRD071", name: "Clear Shampoo 160ml", categoryId: categories[4].id, brandId: brands[2].id, purchasePrice: 14000, sellingPrice: 20000, stock: 20, barcode: "8886008102051", unit: "botol", imageUrl: productImage("Clear\\n160ml", "dbeafe", "1e3a5f") },
    { code: "PRD072", name: "Dove Sabun Batang", categoryId: categories[4].id, brandId: brands[2].id, purchasePrice: 4000, sellingPrice: 6500, stock: 40, barcode: "8886008102052", unit: "pcs", imageUrl: productImage("Dove\\nSabun", "dbeafe", "1e3a5f") },
    { code: "PRD073", name: "Rexona Deo Roll On", categoryId: categories[4].id, brandId: brands[2].id, purchasePrice: 15000, sellingPrice: 22000, stock: 15, barcode: "8886008102053", unit: "pcs", imageUrl: productImage("Rexona\\nRoll On", "dbeafe", "1e3a5f") },
    { code: "PRD074", name: "Wardah Sunscreen SPF30", categoryId: categories[4].id, brandId: brands[26].id, purchasePrice: 18000, sellingPrice: 28000, stock: 12, barcode: "8886008102054", unit: "pcs", imageUrl: productImage("Wardah\\nSunscreen", "fce7f3", "9d174d") },
    { code: "PRD075", name: "Lux Sabun Cair 250ml", categoryId: categories[4].id, brandId: brands[2].id, purchasePrice: 12000, sellingPrice: 18000, stock: 18, barcode: "8886008102055", unit: "botol", imageUrl: productImage("Lux\\nSabun Cair", "ede9fe", "5b21b6") },
    { code: "PRD076", name: "Ciptadent Pasta Gigi 120g", categoryId: categories[4].id, brandId: brands[4].id, purchasePrice: 5000, sellingPrice: 8000, stock: 30, barcode: "8886008102056", unit: "pcs", imageUrl: productImage("Ciptadent\\n120g", "dbeafe", "1e3a5f") },
    { code: "PRD077", name: "Vaseline Lotion 200ml", categoryId: categories[4].id, brandId: brands[2].id, purchasePrice: 16000, sellingPrice: 24000, stock: 14, barcode: "8886008102057", unit: "pcs", imageUrl: productImage("Vaseline\\nLotion", "fef9c3", "854d0e") },
    { code: "PRD078", name: "Biore Body Foam 250ml", categoryId: categories[4].id, brandId: brands[18].id, purchasePrice: 14000, sellingPrice: 20000, stock: 16, barcode: "8886008102058", unit: "botol", imageUrl: productImage("Biore\\nBody Foam", "dbeafe", "1e3a5f") },
    { code: "PRD079", name: "Emeron Shampoo 170ml", categoryId: categories[4].id, brandId: brands[4].id, purchasePrice: 10000, sellingPrice: 15000, stock: 20, barcode: "8886008102059", unit: "botol", imageUrl: productImage("Emeron\\n170ml", "d1fae5", "065f46") },
    { code: "PRD080", name: "Gatsby Hair Gel 75g", categoryId: categories[4].id, brandId: brands[18].id, purchasePrice: 12000, sellingPrice: 18000, stock: 15, barcode: "8886008102060", unit: "pcs", imageUrl: productImage("Gatsby\\nHair Gel", "1e293b", "f1f5f9") },
    // === PRD081-085: Alat Tulis ===
    { code: "PRD081", name: "Pulpen Pilot G2", categoryId: categories[5].id, brandId: brands[3].id, purchasePrice: 5000, sellingPrice: 8000, stock: 60, barcode: "8886008102061", unit: "pcs", imageUrl: productImage("Pilot G2\\nPulpen", "e2e8f0", "334155") },
    { code: "PRD082", name: "Spidol Snowman", categoryId: categories[5].id, brandId: brands[12].id, purchasePrice: 4000, sellingPrice: 7000, stock: 40, barcode: "8886008102062", unit: "pcs", imageUrl: productImage("Snowman\\nSpidol", "e2e8f0", "334155") },
    { code: "PRD083", name: "Tip-X Correction Pen", categoryId: categories[5].id, brandId: brands[3].id, purchasePrice: 6000, sellingPrice: 10000, stock: 30, barcode: "8886008102063", unit: "pcs", imageUrl: productImage("Tip-X\\nPen", "e2e8f0", "334155") },
    { code: "PRD084", name: "Lem Fox Putih 150g", categoryId: categories[5].id, brandId: brands[3].id, purchasePrice: 8000, sellingPrice: 12000, stock: 20, barcode: "8886008102064", unit: "pcs", imageUrl: productImage("Lem Fox\\n150g", "e2e8f0", "334155") },
    { code: "PRD085", name: "Selotip Bening 1 inch", categoryId: categories[5].id, brandId: brands[3].id, purchasePrice: 3000, sellingPrice: 5000, stock: 50, barcode: "8886008102065", unit: "pcs", imageUrl: productImage("Selotip\\nBening", "e2e8f0", "334155") },
    // === PRD086-090: Bumbu & Dapur ===
    { code: "PRD086", name: "Kecap ABC Manis 135ml", categoryId: categories[7].id, brandId: brands[15].id, purchasePrice: 4000, sellingPrice: 6500, stock: 40, barcode: "8886008102066", unit: "botol", imageUrl: productImage("ABC Kecap\\nManis", "fef3c7", "92400e") },
    { code: "PRD087", name: "Saus Sambal ABC 135ml", categoryId: categories[7].id, brandId: brands[15].id, purchasePrice: 3500, sellingPrice: 5500, stock: 45, barcode: "8886008102067", unit: "botol", imageUrl: productImage("ABC Sambal\\n135ml", "fecaca", "991b1b") },
    { code: "PRD088", name: "Masako Ayam 250g", categoryId: categories[7].id, brandId: brands[25].id, purchasePrice: 5000, sellingPrice: 8000, stock: 35, barcode: "8886008102068", unit: "pcs", imageUrl: productImage("Masako\\nAyam", "fef9c3", "854d0e") },
    { code: "PRD089", name: "Minyak Goreng Bimoli 1L", categoryId: categories[7].id, brandId: brands[22].id, purchasePrice: 16000, sellingPrice: 22000, stock: 25, barcode: "8886008102069", unit: "botol", imageUrl: productImage("Bimoli\\n1 Liter", "fef9c3", "854d0e") },
    { code: "PRD090", name: "Gula Pasir Gulaku 1kg", categoryId: categories[7].id, brandId: brands[21].id, purchasePrice: 14000, sellingPrice: 18000, stock: 30, barcode: "8886008102070", unit: "pcs", imageUrl: productImage("Gulaku\\n1kg", "e2e8f0", "334155") },
    // === PRD091-095: Susu & Olahan ===
    { code: "PRD091", name: "Susu Frisian Flag Coklat 225ml", categoryId: categories[8].id, brandId: brands[16].id, purchasePrice: 4000, sellingPrice: 6000, stock: 48, barcode: "8886008102071", unit: "pcs", imageUrl: productImage("FF Coklat\\n225ml", "fef3c7", "92400e") },
    { code: "PRD092", name: "Susu Bendera Kental Manis 385g", categoryId: categories[8].id, brandId: brands[16].id, purchasePrice: 9000, sellingPrice: 13000, stock: 30, barcode: "8886008102072", unit: "kaleng", imageUrl: productImage("Bendera\\nKental", "fef3c7", "92400e") },
    { code: "PRD093", name: "Susu Ultra Full Cream 1L", categoryId: categories[8].id, brandId: brands[29].id, purchasePrice: 16000, sellingPrice: 22000, stock: 20, barcode: "8886008102073", unit: "pcs", imageUrl: productImage("Ultra\\nFull Cream", "dbeafe", "1e3a5f") },
    { code: "PRD094", name: "Keju Kraft Singles 10 slices", categoryId: categories[8].id, brandId: brands[7].id, purchasePrice: 15000, sellingPrice: 22000, stock: 15, barcode: "8886008102074", unit: "pcs", imageUrl: productImage("Kraft\\nSingles", "fef9c3", "854d0e") },
    { code: "PRD095", name: "Bear Brand 189ml", categoryId: categories[8].id, brandId: brands[18].id, purchasePrice: 7000, sellingPrice: 10000, stock: 36, barcode: "8886008102075", unit: "kaleng", imageUrl: productImage("Bear Brand\\n189ml", "e2e8f0", "334155") },
    // === PRD096-098: Frozen Food ===
    { code: "PRD096", name: "So Good Nugget 200g", categoryId: categories[9].id, brandId: brands[23].id, purchasePrice: 15000, sellingPrice: 22000, stock: 20, barcode: "8886008102076", unit: "pcs", imageUrl: productImage("So Good\\nNugget", "fef9c3", "854d0e") },
    { code: "PRD097", name: "Fiesta Sosis Ayam 300g", categoryId: categories[9].id, brandId: brands[23].id, purchasePrice: 18000, sellingPrice: 25000, stock: 15, barcode: "8886008102077", unit: "pcs", imageUrl: productImage("Fiesta\\nSosis", "fecaca", "991b1b") },
    { code: "PRD098", name: "Bernardi Bakso Sapi 250g", categoryId: categories[9].id, brandId: brands[23].id, purchasePrice: 16000, sellingPrice: 23000, stock: 12, barcode: "8886008102078", unit: "pcs", imageUrl: productImage("Bernardi\\nBakso", "fecaca", "991b1b") },
    // === PRD099-100: Obat & Kesehatan ===
    { code: "PRD099", name: "Paracetamol Tablet Strip", categoryId: categories[10].id, brandId: brands[19].id, purchasePrice: 3000, sellingPrice: 5000, stock: 50, barcode: "8886008102079", unit: "strip", imageUrl: productImage("Paracetamol\\nTablet", "d1fae5", "065f46") },
    { code: "PRD100", name: "Hansaplast Plester 10s", categoryId: categories[10].id, brandId: brands[19].id, purchasePrice: 5000, sellingPrice: 8000, stock: 30, barcode: "8886008102080", unit: "pcs", imageUrl: productImage("Hansaplast\\nPlester", "fecaca", "991b1b") },
  ];

  const products = await Promise.all(
    productsData.map((p) => prisma.product.create({ data: { ...p, companyId } })),
  );

  // Create stock movements for initial stock
  await Promise.all(
    products.map((p) =>
      prisma.stockMovement.create({
        data: {
          productId: p.id,
          type: StockMovementType.IN,
          quantity: p.stock,
          note: "Stok awal",
          reference: "INIT",
        },
      }),
    ),
  );

  // Create branch stock for all products in all branches
  const branchStockData = [];
  for (const branch of branchRecords) {
    for (const product of products) {
      branchStockData.push({
        branchId: branch.id,
        productId: product.id,
        quantity: product.stock,
        minStock: product.minStock,
      });
    }
  }
  await prisma.branchStock.createMany({ data: branchStockData });

  // ===========================
  // Create Cigarette Products with Multi-Unit
  // ===========================
  const rokokCategory = categories[6]; // "Rokok" is index 6

  // Sampoerna Mild 16
  const sampoernaMild = await prisma.product.create({
    data: {
      code: "RKK001",
      name: "Sampoerna A Mild 16",
      companyId,
      categoryId: rokokCategory.id,
      brandId: brandSampoerna.id,
      supplierId: supplierTobacco.id,
      purchasePrice: 1800,
      sellingPrice: 2500,
      stock: 4800,
      minStock: 320,
      barcode: "8991234501001",
      unit: "batang",
      imageUrl: productImage("Sampoerna\\nA Mild 16", "fecaca", "991b1b"),
    },
  });
  await prisma.productUnit.createMany({
    data: [
      {
        productId: sampoernaMild.id,
        name: "Bungkus",
        conversionQty: 16,
        sellingPrice: 31000,
        purchasePrice: 27000,
        barcode: "8991234501002",
        sortOrder: 1,
      },
      {
        productId: sampoernaMild.id,
        name: "Slop",
        conversionQty: 160,
        sellingPrice: 300000,
        purchasePrice: 265000,
        barcode: "8991234501003",
        sortOrder: 2,
      },
    ],
  });

  // Gudang Garam Surya 16
  const ggSurya = await prisma.product.create({
    data: {
      code: "RKK002",
      name: "Gudang Garam Surya 16",
      companyId,
      categoryId: rokokCategory.id,
      brandId: brandGudangGaram.id,
      supplierId: supplierTobacco.id,
      purchasePrice: 1700,
      sellingPrice: 2300,
      stock: 3200,
      minStock: 320,
      barcode: "8991234502001",
      unit: "batang",
      imageUrl: productImage("GG Surya\\n16", "fef3c7", "92400e"),
    },
  });
  await prisma.productUnit.createMany({
    data: [
      {
        productId: ggSurya.id,
        name: "Bungkus",
        conversionQty: 16,
        sellingPrice: 29500,
        purchasePrice: 26000,
        barcode: "8991234502002",
        sortOrder: 1,
      },
      {
        productId: ggSurya.id,
        name: "Slop",
        conversionQty: 160,
        sellingPrice: 285000,
        purchasePrice: 255000,
        barcode: "8991234502003",
        sortOrder: 2,
      },
    ],
  });

  // Djarum Super 12
  const djarumSuper = await prisma.product.create({
    data: {
      code: "RKK003",
      name: "Djarum Super 12",
      companyId,
      categoryId: rokokCategory.id,
      brandId: brandDjarum.id,
      supplierId: supplierTobacco.id,
      purchasePrice: 1600,
      sellingPrice: 2200,
      stock: 2400,
      minStock: 240,
      barcode: "8991234503001",
      unit: "batang",
      imageUrl: productImage("Djarum\\nSuper 12", "1e293b", "f1f5f9"),
    },
  });
  await prisma.productUnit.createMany({
    data: [
      {
        productId: djarumSuper.id,
        name: "Bungkus",
        conversionQty: 12,
        sellingPrice: 22000,
        purchasePrice: 18500,
        barcode: "8991234503002",
        sortOrder: 1,
      },
      {
        productId: djarumSuper.id,
        name: "Slop",
        conversionQty: 120,
        sellingPrice: 210000,
        purchasePrice: 180000,
        barcode: "8991234503003",
        sortOrder: 2,
      },
    ],
  });

  // Sampoerna Kretek 12
  const sampoernaKretek = await prisma.product.create({
    data: {
      code: "RKK004",
      name: "Sampoerna Kretek 12",
      companyId,
      categoryId: rokokCategory.id,
      brandId: brandSampoerna.id,
      supplierId: supplierTobacco.id,
      purchasePrice: 1200,
      sellingPrice: 1800,
      stock: 3600,
      minStock: 240,
      barcode: "8991234504001",
      unit: "batang",
      imageUrl: productImage("Sampoerna\\nKretek 12", "fecaca", "991b1b"),
    },
  });
  await prisma.productUnit.createMany({
    data: [
      {
        productId: sampoernaKretek.id,
        name: "Bungkus",
        conversionQty: 12,
        sellingPrice: 18000,
        purchasePrice: 14000,
        barcode: "8991234504002",
        sortOrder: 1,
      },
      {
        productId: sampoernaKretek.id,
        name: "Slop",
        conversionQty: 120,
        sellingPrice: 170000,
        purchasePrice: 135000,
        barcode: "8991234504003",
        sortOrder: 2,
      },
      {
        productId: sampoernaKretek.id,
        name: "Box",
        conversionQty: 1200,
        sellingPrice: 1650000,
        purchasePrice: 1300000,
        barcode: "8991234504004",
        sortOrder: 3,
      },
    ],
  });

  // Gudang Garam Filter 12
  const ggFilter = await prisma.product.create({
    data: {
      code: "RKK005",
      name: "Gudang Garam International",
      companyId,
      categoryId: rokokCategory.id,
      brandId: brandGudangGaram.id,
      supplierId: supplierTobacco.id,
      purchasePrice: 1500,
      sellingPrice: 2000,
      stock: 2880,
      minStock: 240,
      barcode: "8991234505001",
      unit: "batang",
      imageUrl: productImage("GG\\nInternational", "fef3c7", "92400e"),
    },
  });
  await prisma.productUnit.createMany({
    data: [
      {
        productId: ggFilter.id,
        name: "Bungkus",
        conversionQty: 12,
        sellingPrice: 20000,
        purchasePrice: 17000,
        barcode: "8991234505002",
        sortOrder: 1,
      },
      {
        productId: ggFilter.id,
        name: "Slop",
        conversionQty: 120,
        sellingPrice: 195000,
        purchasePrice: 165000,
        barcode: "8991234505003",
        sortOrder: 2,
      },
    ],
  });

  // Stock movements for cigarette products
  const cigaretteProducts = [
    sampoernaMild,
    ggSurya,
    djarumSuper,
    sampoernaKretek,
    ggFilter,
  ];
  await Promise.all(
    cigaretteProducts.map((p) =>
      prisma.stockMovement.create({
        data: {
          productId: p.id,
          type: StockMovementType.IN,
          quantity: p.stock,
          note: "Stok awal rokok",
          reference: "INIT",
        },
      }),
    ),
  );

  // Create branch stock for cigarette products
  const cigBranchStockData = [];
  for (const branch of branchRecords) {
    for (const product of cigaretteProducts) {
      cigBranchStockData.push({
        branchId: branch.id,
        productId: product.id,
        quantity: product.stock,
        minStock: product.minStock,
      });
    }
  }
  await prisma.branchStock.createMany({ data: cigBranchStockData });

  console.log(
    `Created ${cigaretteProducts.length} cigarette products with multi-unit`,
  );

  // Create sample transactions
  const now = new Date();
  const transactions = [];

  for (let i = 0; i < 30; i++) {
    const daysAgo = Math.floor(Math.random() * 30);
    const date = new Date(now);
    date.setDate(date.getDate() - daysAgo);
    date.setHours(Math.floor(Math.random() * 12) + 8);

    const itemCount = Math.floor(Math.random() * 4) + 1;
    const selectedProducts = [...products]
      .sort(() => Math.random() - 0.5)
      .slice(0, itemCount);

    const items = selectedProducts.map((p) => {
      const qty = Math.floor(Math.random() * 5) + 1;
      return {
        productId: p.id,
        productName: p.name,
        productCode: p.code,
        quantity: qty,
        unitPrice: p.sellingPrice,
        discount: 0,
        subtotal: p.sellingPrice * qty,
      };
    });

    const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
    const taxAmount = Math.round(subtotal * 0.11);
    const grandTotal = subtotal + taxAmount;
    const paymentAmount = Math.ceil(grandTotal / 1000) * 1000;

    const cashier = Math.random() > 0.5 ? cashier1 : cashier2;
    const methods: PaymentMethod[] = ["CASH", "TRANSFER", "QRIS"];
    const method = methods[
      Math.floor(Math.random() * methods.length)
    ] as PaymentMethod;

    const invoiceNum = `INV-${date.getFullYear().toString().slice(-2)}${(date.getMonth() + 1).toString().padStart(2, "0")}${date.getDate().toString().padStart(2, "0")}-${String(i + 1).padStart(4, "0")}`;

    const tx = await prisma.transaction.create({
      data: {
        invoiceNumber: invoiceNum,
        userId: cashier.id,
        subtotal,
        taxAmount,
        grandTotal,
        paymentMethod: method,
        paymentAmount,
        changeAmount: paymentAmount - grandTotal,
        status: "COMPLETED",
        createdAt: date,
        items: { create: items },
      },
    });

    transactions.push(tx);
  }

  // Create last year transactions (100 transactions spread across 12 months)
  const lastYear = now.getFullYear() - 1;
  for (let i = 0; i < 100; i++) {
    const month = Math.floor(Math.random() * 12);
    const day = Math.floor(Math.random() * 28) + 1;
    const hour = Math.floor(Math.random() * 12) + 8;
    const date = new Date(lastYear, month, day, hour, Math.floor(Math.random() * 60));

    const itemCount = Math.floor(Math.random() * 5) + 1;
    const selectedProducts = [...products]
      .sort(() => Math.random() - 0.5)
      .slice(0, itemCount);

    const items = selectedProducts.map((p) => {
      const qty = Math.floor(Math.random() * 5) + 1;
      return {
        productId: p.id,
        productName: p.name,
        productCode: p.code,
        quantity: qty,
        unitPrice: p.sellingPrice,
        discount: 0,
        subtotal: p.sellingPrice * qty,
      };
    });

    const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
    const taxAmount = Math.round(subtotal * 0.11);
    const grandTotal = subtotal + taxAmount;
    const paymentAmount = Math.ceil(grandTotal / 1000) * 1000;

    const cashier = Math.random() > 0.5 ? cashier1 : cashier2;
    const methods: PaymentMethod[] = ["CASH", "TRANSFER", "QRIS"];
    const method = methods[Math.floor(Math.random() * methods.length)] as PaymentMethod;

    const lyInvoice = `INV-${String(lastYear).slice(-2)}${String(month + 1).padStart(2, "0")}${String(day).padStart(2, "0")}-${String(i + 1).padStart(4, "0")}`;

    await prisma.transaction.create({
      data: {
        invoiceNumber: lyInvoice,
        userId: cashier.id,
        subtotal,
        taxAmount,
        grandTotal,
        paymentMethod: method,
        paymentAmount,
        changeAmount: paymentAmount - grandTotal,
        status: "COMPLETED",
        createdAt: date,
        items: { create: items },
      },
    });
  }
  console.log("Created 100 last year transactions");

  // Create Expenses
  const expenseCategories = [
    "Listrik",
    "Air",
    "Sewa",
    "Gaji",
    "Transport",
    "Lainnya",
  ];
  for (let i = 0; i < 10; i++) {
    const daysAgo = Math.floor(Math.random() * 30);
    const date = new Date(now);
    date.setDate(date.getDate() - daysAgo);
    await prisma.expense.create({
      data: {
        category:
          expenseCategories[
            Math.floor(Math.random() * expenseCategories.length)
          ],
        description: `Pengeluaran operasional ${i + 1}`,
        amount: Math.floor(Math.random() * 500000) + 50000,
        date,
      },
    });
  }

  // Create Promotions
  const promoStart = new Date(now);
  promoStart.setDate(promoStart.getDate() - 15);
  const promoEnd = new Date(now);
  promoEnd.setDate(promoEnd.getDate() + 30);

  await Promise.all([
    prisma.promotion.create({
      data: {
        name: "Diskon Minuman 10%",
        companyId,
        type: "DISCOUNT_PERCENT",
        value: 10,
        categoryId: categories[1].id,
        isActive: true,
        startDate: promoStart,
        endDate: promoEnd,
      },
    }),
    prisma.promotion.create({
      data: {
        name: "Potongan Rp 5.000",
        companyId,
        type: "DISCOUNT_AMOUNT",
        value: 5000,
        minPurchase: 50000,
        isActive: true,
        startDate: promoStart,
        endDate: promoEnd,
      },
    }),
    prisma.promotion.create({
      data: {
        name: "Voucher HEMAT20",
        companyId,
        type: "VOUCHER",
        value: 20000,
        voucherCode: "HEMAT20",
        minPurchase: 100000,
        isActive: true,
        startDate: promoStart,
        endDate: promoEnd,
      },
    }),
  ]);

  // Create Audit Logs
  await Promise.all([
    prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "LOGIN",
        entity: "User",
        details: "Super Admin logged in",
      },
    }),
    prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: "CREATE",
        entity: "Product",
        details: "Created 20 products via seed",
      },
    }),
    prisma.auditLog.create({
      data: {
        userId: manager.id,
        action: "LOGIN",
        entity: "User",
        details: "Manager logged in",
      },
    }),
  ]);

  // Seed system roles
  await Promise.all([
    prisma.appRole.create({ data: { key: "SUPER_ADMIN", name: "Super Admin", description: "Akses penuh ke seluruh sistem", color: "bg-red-100 text-red-700", isSystem: true } }),
    prisma.appRole.create({ data: { key: "ADMIN", name: "Admin", description: "Mengelola operasional & konfigurasi", color: "bg-blue-100 text-blue-700", isSystem: true } }),
    prisma.appRole.create({ data: { key: "MANAGER", name: "Manager", description: "Mengelola produk, stok & laporan", color: "bg-purple-100 text-purple-700", isSystem: true } }),
    prisma.appRole.create({ data: { key: "CASHIER", name: "Kasir", description: "Transaksi POS & shift kasir", color: "bg-green-100 text-green-700", isSystem: true } }),
  ]);

  // Seed point settings
  const pointSettings = [
    {
      key: "points.earnRate",
      value: "10000",
      label: "Rupiah per 1 poin",
      group: "points",
    },
    {
      key: "points.redeemValue",
      value: "1000",
      label: "Nilai tukar 1 poin (Rp)",
      group: "points",
    },
    {
      key: "points.redeemMin",
      value: "10",
      label: "Minimum poin redeem",
      group: "points",
    },
    {
      key: "points.multiplierRegular",
      value: "1",
      label: "Multiplier Regular",
      group: "points",
    },
    {
      key: "points.multiplierSilver",
      value: "1.5",
      label: "Multiplier Silver",
      group: "points",
    },
    {
      key: "points.multiplierGold",
      value: "2",
      label: "Multiplier Gold",
      group: "points",
    },
    {
      key: "points.multiplierPlatinum",
      value: "3",
      label: "Multiplier Platinum",
      group: "points",
    },
    {
      key: "points.levelSilver",
      value: "1000000",
      label: "Threshold Silver (Rp)",
      group: "points",
    },
    {
      key: "points.levelGold",
      value: "5000000",
      label: "Threshold Gold (Rp)",
      group: "points",
    },
    {
      key: "points.levelPlatinum",
      value: "10000000",
      label: "Threshold Platinum (Rp)",
      group: "points",
    },
    {
      key: "points.pointsEnabled",
      value: "true",
      label: "Sistem poin aktif",
      group: "points",
    },
  ];
  for (const s of pointSettings) {
    const existing = await prisma.setting.findFirst({ where: { key: s.key, branchId: null } });
    if (!existing) await prisma.setting.create({ data: s });
  }

  // Seed kitchen display settings
  const kitchenSettings = [
    { key: "kitchen.enabled", value: "false", label: "Kirim order ke Kitchen Display", group: "kitchen" },
    { key: "kitchen.autoAdvance", value: "false", label: "Auto-advance status", group: "kitchen" },
    { key: "kitchen.notificationSound", value: "true", label: "Suara notifikasi order baru", group: "kitchen" },
  ];
  for (const s of kitchenSettings) {
    const existing = await prisma.setting.findFirst({ where: { key: s.key, branchId: null } });
    if (!existing) await prisma.setting.create({ data: s });
  }

  // ===========================
  // Seed Accounting Data
  // ===========================

  // Create Account Categories
  const accountCategories = await Promise.all([
    prisma.accountCategory.create({ data: { name: "Aset", type: "ASSET", normalSide: "DEBIT", sortOrder: 1, companyId } }),
    prisma.accountCategory.create({ data: { name: "Kewajiban", type: "LIABILITY", normalSide: "CREDIT", sortOrder: 2, companyId } }),
    prisma.accountCategory.create({ data: { name: "Modal", type: "EQUITY", normalSide: "CREDIT", sortOrder: 3, companyId } }),
    prisma.accountCategory.create({ data: { name: "Pendapatan", type: "REVENUE", normalSide: "CREDIT", sortOrder: 4, companyId } }),
    prisma.accountCategory.create({ data: { name: "Beban", type: "EXPENSE", normalSide: "DEBIT", sortOrder: 5, companyId } }),
  ]);

  const catAsset = accountCategories[0].id;
  const catLiability = accountCategories[1].id;
  const catEquity = accountCategories[2].id;
  const catRevenue = accountCategories[3].id;
  const catExpense = accountCategories[4].id;

  // Create Chart of Accounts — system + tambahan
  const accountsData = [
    // ASET (1-xxxx)
    { code: "1-1001", name: "Kas", catId: catAsset, desc: "Kas tunai", isSystem: true, opening: 50000000 },
    { code: "1-1002", name: "Bank", catId: catAsset, desc: "Rekening bank", isSystem: true, opening: 150000000 },
    { code: "1-1003", name: "Piutang Dagang", catId: catAsset, desc: "Piutang dari pelanggan", isSystem: true, opening: 12500000 },
    { code: "1-1004", name: "Persediaan Barang", catId: catAsset, desc: "Persediaan barang dagangan", isSystem: true, opening: 85000000 },
    { code: "1-1005", name: "Perlengkapan Toko", catId: catAsset, desc: "Plastik, kertas struk, dll", isSystem: false, opening: 3000000 },
    { code: "1-2001", name: "Peralatan Toko", catId: catAsset, desc: "Rak, etalase, mesin kasir", isSystem: false, opening: 25000000 },
    { code: "1-2002", name: "Akumulasi Penyusutan Peralatan", catId: catAsset, desc: "Contra asset — penyusutan", isSystem: false, opening: -5000000 },
    // KEWAJIBAN (2-xxxx)
    { code: "2-1001", name: "Hutang Dagang", catId: catLiability, desc: "Hutang ke supplier", isSystem: true, opening: 35000000 },
    { code: "2-1002", name: "Hutang Pajak", catId: catLiability, desc: "PPN & pajak lainnya", isSystem: false, opening: 8500000 },
    { code: "2-1003", name: "Hutang Gaji", catId: catLiability, desc: "Gaji karyawan yang belum dibayar", isSystem: false, opening: 0 },
    // MODAL (3-xxxx)
    { code: "3-1001", name: "Modal Pemilik", catId: catEquity, desc: "Modal pemilik usaha", isSystem: true, opening: 250000000 },
    { code: "3-1002", name: "Laba Ditahan", catId: catEquity, desc: "Akumulasi laba periode sebelumnya", isSystem: false, opening: 27000000 },
    // PENDAPATAN (4-xxxx)
    { code: "4-1001", name: "Pendapatan Penjualan", catId: catRevenue, desc: "Pendapatan dari penjualan barang", isSystem: true, opening: 0 },
    { code: "4-1002", name: "Retur Penjualan", catId: catRevenue, desc: "Contra revenue — retur penjualan", isSystem: true, opening: 0 },
    { code: "4-2001", name: "Pendapatan Lain-lain", catId: catRevenue, desc: "Pendapatan non-operasional", isSystem: false, opening: 0 },
    // BEBAN (5-xxxx)
    { code: "5-1001", name: "Harga Pokok Penjualan", catId: catExpense, desc: "HPP / COGS", isSystem: true, opening: 0 },
    { code: "5-1002", name: "Beban Operasional", catId: catExpense, desc: "Beban operasional umum", isSystem: true, opening: 0 },
    { code: "5-1003", name: "Beban Gaji", catId: catExpense, desc: "Beban gaji karyawan", isSystem: true, opening: 0 },
    { code: "5-1004", name: "Beban Listrik & Air", catId: catExpense, desc: "Tagihan listrik dan air", isSystem: false, opening: 0 },
    { code: "5-1005", name: "Beban Sewa", catId: catExpense, desc: "Sewa tempat usaha", isSystem: false, opening: 0 },
    { code: "5-1006", name: "Beban Perlengkapan", catId: catExpense, desc: "Pemakaian perlengkapan toko", isSystem: false, opening: 0 },
    { code: "5-1007", name: "Beban Penyusutan", catId: catExpense, desc: "Penyusutan peralatan", isSystem: false, opening: 0 },
    { code: "5-1008", name: "Beban Transport", catId: catExpense, desc: "Biaya transportasi & pengiriman", isSystem: false, opening: 0 },
    { code: "5-2001", name: "Beban Lain-lain", catId: catExpense, desc: "Beban non-operasional", isSystem: false, opening: 0 },
  ];

  const createdAccounts = await Promise.all(
    accountsData.map((a) =>
      prisma.account.create({
        data: {
          code: a.code,
          name: a.name,
          description: a.desc,
          categoryId: a.catId,
          isSystem: a.isSystem,
          isActive: true,
          openingBalance: a.opening,
        },
      })
    )
  );

  // Map account code → id for quick lookup
  const acctMap = new Map(createdAccounts.map((a) => [a.code, a.id]));
  const acct = (code: string) => acctMap.get(code)!;

  // Create Accounting Periods — 3 bulan terakhir + bulan ini
  const periods = [];
  for (let m = 3; m >= 0; m--) {
    const pStart = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const pEnd = new Date(now.getFullYear(), now.getMonth() - m + 1, 0);
    const monthName = pStart.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
    const status = m === 0 ? "OPEN" : m === 3 ? "LOCKED" : "CLOSED";
    const period = await prisma.accountingPeriod.create({
      data: {
        name: monthName,
        startDate: pStart,
        endDate: pEnd,
        status,
        ...(status !== "OPEN" ? { closedBy: admin.id, closedAt: pEnd } : {}),
      },
    });
    periods.push(period);
  }
  const currentPeriod = periods[periods.length - 1];

  // Helper: create journal entry
  let journalSeq = 0;
  const createJournal = async (opts: {
    date: Date;
    description: string;
    reference?: string;
    referenceType?: string;
    lines: { accountCode: string; desc: string; debit: number; credit: number }[];
    status?: string;
    periodId?: string;
  }) => {
    journalSeq++;
    const d = opts.date;
    const yy = d.getFullYear().toString().slice(-2);
    const mm = (d.getMonth() + 1).toString().padStart(2, "0");
    const dd = d.getDate().toString().padStart(2, "0");
    const entryNumber = `JV-${yy}${mm}${dd}-${String(journalSeq).padStart(4, "0")}`;
    const totalDebit = opts.lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = opts.lines.reduce((s, l) => s + l.credit, 0);

    // Find matching period
    let periodId = opts.periodId;
    if (!periodId) {
      const matching = periods.find((p) => d >= p.startDate && d <= p.endDate);
      periodId = matching?.id;
    }

    return prisma.journalEntry.create({
      data: {
        entryNumber,
        date: d,
        description: opts.description,
        reference: opts.reference || null,
        referenceType: opts.referenceType || "MANUAL",
        status: opts.status || "POSTED",
        totalDebit,
        totalCredit,
        createdBy: admin.id,
        periodId: periodId || null,
        lines: {
          create: opts.lines.map((l, idx) => ({
            accountId: acct(l.accountCode),
            description: l.desc,
            debit: l.debit,
            credit: l.credit,
            sortOrder: idx,
          })),
        },
      },
    });
  };

  // ======== JOURNAL ENTRIES — 3 bulan data ========

  // --- Saldo Awal (awal 3 bulan lalu) ---
  const month3Ago = new Date(now.getFullYear(), now.getMonth() - 3, 1);
  await createJournal({
    date: month3Ago,
    description: "Saldo awal — Modal pemilik disetor",
    referenceType: "MANUAL",
    lines: [
      { accountCode: "1-1001", desc: "Setoran kas tunai", debit: 50000000, credit: 0 },
      { accountCode: "1-1002", desc: "Setoran ke rekening bank", debit: 150000000, credit: 0 },
      { accountCode: "1-1004", desc: "Persediaan awal barang dagangan", debit: 85000000, credit: 0 },
      { accountCode: "1-2001", desc: "Peralatan toko", debit: 25000000, credit: 0 },
      { accountCode: "1-1005", desc: "Perlengkapan toko", debit: 3000000, credit: 0 },
      { accountCode: "2-1001", desc: "Hutang dagang awal", debit: 0, credit: 35000000 },
      { accountCode: "3-1001", desc: "Modal pemilik", debit: 0, credit: 250000000 },
      { accountCode: "3-1002", desc: "Laba ditahan periode sebelumnya", debit: 0, credit: 27000000 },
      { accountCode: "2-1002", desc: "Hutang pajak", debit: 0, credit: 1000000 },
    ],
  });

  // --- Loop 3 bulan: buat jurnal penjualan, pembelian, beban ---
  for (let m = 2; m >= 0; m--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() - m + 1, 0).getDate();
    const monthLabel = monthStart.toLocaleDateString("id-ID", { month: "short", year: "numeric" });

    // ~20 jurnal penjualan per bulan
    for (let d = 1; d <= Math.min(daysInMonth, 28); d += 1) {
      if (d % 2 !== 0 && d > 1) continue; // skip odd days kecuali hari 1
      const saleDate = new Date(now.getFullYear(), now.getMonth() - m, d, 10 + (d % 4));

      // Revenue bervariasi: 2jt - 8jt per hari
      const revenue = Math.round((2000000 + Math.random() * 6000000) / 1000) * 1000;
      const cogs = Math.round(revenue * (0.55 + Math.random() * 0.15)); // 55-70% margin
      const paymentCash = Math.random() > 0.4;
      const invoiceNum = `INV-${saleDate.getFullYear().toString().slice(-2)}${(saleDate.getMonth() + 1).toString().padStart(2, "0")}${saleDate.getDate().toString().padStart(2, "0")}`;

      // Jurnal penjualan
      await createJournal({
        date: saleDate,
        description: `Penjualan harian ${invoiceNum}`,
        reference: invoiceNum,
        referenceType: "TRANSACTION",
        lines: [
          { accountCode: paymentCash ? "1-1001" : "1-1002", desc: `Penerimaan ${paymentCash ? "kas" : "bank"} — ${invoiceNum}`, debit: revenue, credit: 0 },
          { accountCode: "4-1001", desc: `Pendapatan penjualan — ${invoiceNum}`, debit: 0, credit: revenue },
          { accountCode: "5-1001", desc: `HPP — ${invoiceNum}`, debit: cogs, credit: 0 },
          { accountCode: "1-1004", desc: `Pengurangan persediaan — ${invoiceNum}`, debit: 0, credit: cogs },
        ],
      });
    }

    // 3 pembelian barang per bulan
    for (let p = 0; p < 3; p++) {
      const purchaseDay = 5 + p * 9; // hari 5, 14, 23
      const purchaseDate = new Date(now.getFullYear(), now.getMonth() - m, Math.min(purchaseDay, daysInMonth), 9);
      const poAmount = Math.round((10000000 + Math.random() * 20000000) / 1000) * 1000;
      const paidCash = Math.round(poAmount * (0.3 + Math.random() * 0.4)); // bayar 30-70%
      const hutang = poAmount - paidCash;
      const poNum = `PO-${purchaseDate.getFullYear().toString().slice(-2)}${(purchaseDate.getMonth() + 1).toString().padStart(2, "0")}-${String(p + 1).padStart(3, "0")}`;

      await createJournal({
        date: purchaseDate,
        description: `Pembelian barang ${poNum}`,
        reference: poNum,
        referenceType: "PURCHASE",
        lines: [
          { accountCode: "1-1004", desc: `Persediaan masuk — ${poNum}`, debit: poAmount, credit: 0 },
          { accountCode: "1-1001", desc: `Pembayaran tunai — ${poNum}`, debit: 0, credit: paidCash },
          ...(hutang > 0 ? [{ accountCode: "2-1001", desc: `Hutang dagang — ${poNum}`, debit: 0, credit: hutang }] : []),
        ],
      });
    }

    // Pembayaran hutang dagang — 1x per bulan
    const debtPayDate = new Date(now.getFullYear(), now.getMonth() - m, 20, 11);
    const debtPayAmount = Math.round((5000000 + Math.random() * 10000000) / 1000) * 1000;
    await createJournal({
      date: debtPayDate,
      description: `Pelunasan hutang supplier ${monthLabel}`,
      referenceType: "DEBT_PAYMENT",
      lines: [
        { accountCode: "2-1001", desc: "Pelunasan hutang dagang", debit: debtPayAmount, credit: 0 },
        { accountCode: "1-1002", desc: "Transfer bank ke supplier", debit: 0, credit: debtPayAmount },
      ],
    });

    // Beban gaji — akhir bulan
    const gajiDate = new Date(now.getFullYear(), now.getMonth() - m, Math.min(28, daysInMonth), 15);
    const totalGaji = 15000000 + Math.round(Math.random() * 3000000);
    await createJournal({
      date: gajiDate,
      description: `Pembayaran gaji karyawan ${monthLabel}`,
      referenceType: "EXPENSE",
      lines: [
        { accountCode: "5-1003", desc: "Beban gaji karyawan", debit: totalGaji, credit: 0 },
        { accountCode: "1-1002", desc: "Transfer gaji via bank", debit: 0, credit: totalGaji },
      ],
    });

    // Beban sewa — awal bulan
    const sewaDate = new Date(now.getFullYear(), now.getMonth() - m, 1, 8);
    await createJournal({
      date: sewaDate,
      description: `Pembayaran sewa toko ${monthLabel}`,
      referenceType: "EXPENSE",
      lines: [
        { accountCode: "5-1005", desc: "Beban sewa bulanan", debit: 8000000, credit: 0 },
        { accountCode: "1-1002", desc: "Transfer bank sewa", debit: 0, credit: 8000000 },
      ],
    });

    // Beban listrik & air — pertengahan bulan
    const listrikDate = new Date(now.getFullYear(), now.getMonth() - m, 15, 10);
    const listrikAmount = 2000000 + Math.round(Math.random() * 1000000);
    await createJournal({
      date: listrikDate,
      description: `Pembayaran listrik & air ${monthLabel}`,
      referenceType: "EXPENSE",
      lines: [
        { accountCode: "5-1004", desc: "Tagihan listrik & air", debit: listrikAmount, credit: 0 },
        { accountCode: "1-1001", desc: "Pembayaran kas", debit: 0, credit: listrikAmount },
      ],
    });

    // Beban operasional lainnya — 2x per bulan
    for (let e = 0; e < 2; e++) {
      const opDate = new Date(now.getFullYear(), now.getMonth() - m, 8 + e * 12, 14);
      const opAmount = 500000 + Math.round(Math.random() * 1500000);
      const opDescs = ["Pembelian kantong plastik & kertas struk", "Biaya kebersihan & maintenance", "Pembelian ATK kantor", "Biaya parkir & transportasi"];
      const opDesc = opDescs[Math.floor(Math.random() * opDescs.length)];
      const opAcct = e === 0 ? "5-1006" : "5-1008";
      await createJournal({
        date: opDate,
        description: `${opDesc} ${monthLabel}`,
        referenceType: "EXPENSE",
        lines: [
          { accountCode: opAcct, desc: opDesc!, debit: opAmount, credit: 0 },
          { accountCode: "1-1001", desc: "Pembayaran kas", debit: 0, credit: opAmount },
        ],
      });
    }

    // Beban penyusutan — akhir bulan (jurnal penyesuaian)
    const penyusutanDate = new Date(now.getFullYear(), now.getMonth() - m, Math.min(28, daysInMonth), 17);
    await createJournal({
      date: penyusutanDate,
      description: `Penyusutan peralatan toko ${monthLabel}`,
      referenceType: "MANUAL",
      lines: [
        { accountCode: "5-1007", desc: "Beban penyusutan peralatan", debit: 416667, credit: 0 },
        { accountCode: "1-2002", desc: "Akumulasi penyusutan", debit: 0, credit: 416667 },
      ],
    });

    // Penerimaan piutang — 1x per bulan
    if (m < 2) {
      const piutangDate = new Date(now.getFullYear(), now.getMonth() - m, 12, 11);
      const piutangAmount = 3000000 + Math.round(Math.random() * 5000000);
      await createJournal({
        date: piutangDate,
        description: `Penerimaan piutang pelanggan ${monthLabel}`,
        referenceType: "DEBT_PAYMENT",
        lines: [
          { accountCode: "1-1002", desc: "Penerimaan via transfer bank", debit: piutangAmount, credit: 0 },
          { accountCode: "1-1003", desc: "Pelunasan piutang dagang", debit: 0, credit: piutangAmount },
        ],
      });
    }

    // Retur penjualan — 1x per bulan (kecuali bulan pertama)
    if (m < 2) {
      const returDate = new Date(now.getFullYear(), now.getMonth() - m, 18, 13);
      const returAmount = 500000 + Math.round(Math.random() * 1000000);
      const returCogs = Math.round(returAmount * 0.6);
      await createJournal({
        date: returDate,
        description: `Retur penjualan ${monthLabel}`,
        referenceType: "RETURN",
        lines: [
          { accountCode: "4-1002", desc: "Retur penjualan", debit: returAmount, credit: 0 },
          { accountCode: "1-1001", desc: "Pengembalian kas ke pelanggan", debit: 0, credit: returAmount },
          { accountCode: "1-1004", desc: "Barang kembali ke persediaan", debit: returCogs, credit: 0 },
          { accountCode: "5-1001", desc: "Reversal HPP", debit: 0, credit: returCogs },
        ],
      });
    }
  }

  // --- Bulan ini: 1 jurnal DRAFT ---
  await createJournal({
    date: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9),
    description: "Pendapatan lain-lain — pengembalian kelebihan bayar dari vendor",
    referenceType: "MANUAL",
    status: "DRAFT",
    lines: [
      { accountCode: "1-1002", desc: "Masuk ke rekening bank", debit: 750000, credit: 0 },
      { accountCode: "4-2001", desc: "Pendapatan lain-lain", debit: 0, credit: 750000 },
    ],
  });

  console.log(`Created ${accountCategories.length} account categories`);
  console.log(`Created ${accountsData.length} accounts (COA)`);
  console.log(`Created ${periods.length} accounting periods`);
  console.log(`Created ${journalSeq} journal entries`);

  // ===========================
  // Seed Restaurant Tables
  // ===========================
  const tablesData = [];

  // Indoor: tables 1-8
  for (let i = 1; i <= 8; i++) {
    tablesData.push({ number: i, name: `Meja ${i}`, capacity: 4, section: "Indoor", sortOrder: i });
  }
  // Outdoor: tables 9-14
  for (let i = 9; i <= 14; i++) {
    tablesData.push({ number: i, name: `Outdoor ${i - 8}`, capacity: 2, section: "Outdoor", sortOrder: i });
  }
  // VIP: tables 15-17
  for (let i = 15; i <= 17; i++) {
    tablesData.push({ number: i, name: `VIP ${i - 14}`, capacity: 6, section: "VIP", sortOrder: i });
  }

  await prisma.restaurantTable.createMany({ data: tablesData });
  console.log(`Created ${tablesData.length} restaurant tables`);

  // ===========================
  // Seed Product Bundles
  // ===========================

  // Find some products for bundles
  const indomie = products.find((p) => p.name.includes("Indomie"));
  const tehBotol = products.find((p) => p.name.includes("Teh Botol"));
  const aqua = products.find((p) => p.name.includes("Aqua"));
  const cocaCola = products.find((p) => p.name.includes("Coca"));

  if (indomie && tehBotol) {
    await prisma.productBundle.create({
      data: {
        code: "BDL001",
        name: "Paket Hemat Indomie",
        description: "1 Indomie Goreng + 1 Teh Botol Sosro",
        sellingPrice: 8000,
        totalBasePrice: (indomie.sellingPrice + tehBotol.sellingPrice),
        categoryId: categories[0].id,
        items: {
          create: [
            { productId: indomie.id, quantity: 1, sortOrder: 1 },
            { productId: tehBotol.id, quantity: 1, sortOrder: 2 },
          ],
        },
      },
    });
  }

  if (indomie && tehBotol && aqua) {
    await prisma.productBundle.create({
      data: {
        code: "BDL002",
        name: "Paket Keluarga",
        description: "3 Indomie Goreng + 2 Teh Botol + 1 Aqua",
        sellingPrice: 25000,
        totalBasePrice: (indomie.sellingPrice * 3 + tehBotol.sellingPrice * 2 + (aqua?.sellingPrice ?? 0)),
        categoryId: categories[0].id,
        items: {
          create: [
            { productId: indomie.id, quantity: 3, sortOrder: 1 },
            { productId: tehBotol.id, quantity: 2, sortOrder: 2 },
            ...(aqua ? [{ productId: aqua.id, quantity: 1, sortOrder: 3 }] : []),
          ],
        },
      },
    });
  }

  if (cocaCola && aqua) {
    await prisma.productBundle.create({
      data: {
        code: "BDL003",
        name: "Paket Minuman Segar",
        description: "2 Coca-Cola + 2 Aqua",
        sellingPrice: 18000,
        totalBasePrice: ((cocaCola?.sellingPrice ?? 0) * 2 + (aqua?.sellingPrice ?? 0) * 2),
        categoryId: categories[1].id,
        items: {
          create: [
            ...(cocaCola ? [{ productId: cocaCola.id, quantity: 2, sortOrder: 1 }] : []),
            { productId: aqua.id, quantity: 2, sortOrder: 2 },
          ],
        },
      },
    });
  }

  console.log("Created product bundles");

  console.log("Seeding completed!");
  console.log(`Created ${await prisma.user.count()} users`);
  console.log(`Created ${await prisma.category.count()} categories`);
  console.log(`Created ${await prisma.product.count()} products`);
  console.log(`Created ${await prisma.transaction.count()} transactions`);
  console.log(`Created ${await prisma.brand.count()} brands`);
  console.log(`Created ${await prisma.supplier.count()} suppliers`);
  console.log(`Created ${await prisma.customer.count()} customers`);
  console.log(`Created ${await prisma.branch.count()} branches`);
  console.log(`Created ${await prisma.expense.count()} expenses`);
  console.log(`Created ${await prisma.promotion.count()} promotions`);
  console.log(`Created ${await prisma.accountCategory.count()} account categories`);
  console.log(`Created ${await prisma.account.count()} accounts`);
  console.log(`Created ${await prisma.accountingPeriod.count()} accounting periods`);
  console.log("");
  console.log("Login credentials:");
  console.log("  Admin:   admin@pos.com / password123");
  console.log("  Manager: manager@pos.com / password123");
  console.log("  Kasir:   kasir1@pos.com / password123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
