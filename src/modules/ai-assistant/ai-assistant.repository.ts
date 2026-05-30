import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

// ── Raw SQL row types ────────────────────────────────────────────────

export type RawLowStockProduct = {
  id: string;
  name: string;
  code: string;
  stock: number;
  minStock: number;
  unit: string;
  sellingPrice: number;
  purchasePrice: number;
  supplierName: string | null;
  supplierId: string | null;
  categoryName: string | null;
};

export type RawCategorySalesRow = {
  name: string;
  qty: bigint;
  revenue: bigint;
  items: bigint;
};

// ── SELECT constants ─────────────────────────────────────────────────

const SLOW_PRODUCT_SELECT = {
  id: true,
  name: true,
  code: true,
  stock: true,
  sellingPrice: true,
  purchasePrice: true,
  unit: true,
  category: { select: { name: true } },
} satisfies Prisma.ProductSelect;

export type RawSlowProduct = Prisma.ProductGetPayload<{
  select: typeof SLOW_PRODUCT_SELECT;
}>;

const SEARCH_PRODUCT_SELECT = {
  id: true,
  name: true,
  code: true,
  stock: true,
  sellingPrice: true,
  purchasePrice: true,
  unit: true,
  minStock: true,
  category: { select: { name: true } },
  supplier: { select: { id: true, name: true } },
  defaultRack: {
    select: {
      id: true,
      code: true,
      name: true,
      location: true,
      branch: { select: { name: true } },
    },
  },
} satisfies Prisma.ProductSelect;

export type RawSearchProduct = Prisma.ProductGetPayload<{
  select: typeof SEARCH_PRODUCT_SELECT;
}>;

const PRODUCT_LOCATION_SELECT = {
  id: true,
  name: true,
  code: true,
  unit: true,
  sellingPrice: true,
  stock: true,
  category: { select: { name: true } },
  defaultRack: {
    select: {
      id: true,
      code: true,
      name: true,
      location: true,
      branch: { select: { id: true, name: true } },
    },
  },
  rackStocks: {
    where: { qty: { gt: 0 } },
    select: {
      qty: true,
      rack: {
        select: {
          id: true,
          code: true,
          name: true,
          location: true,
          branch: { select: { id: true, name: true } },
        },
      },
    },
  },
  branchStocks: {
    select: {
      quantity: true,
      branch: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.ProductSelect;

export type RawProductLocation = Prisma.ProductGetPayload<{
  select: typeof PRODUCT_LOCATION_SELECT;
}>;

const RACK_CONTENTS_SELECT = {
  id: true,
  code: true,
  name: true,
  location: true,
  isActive: true,
  branch: { select: { name: true } },
  rackStocks: {
    where: { qty: { gt: 0 } },
    select: {
      qty: true,
      product: {
        select: {
          code: true,
          name: true,
          unit: true,
          category: { select: { name: true } },
        },
      },
    },
    orderBy: { qty: "desc" as const },
  },
  defaultForProducts: {
    select: {
      code: true,
      name: true,
      unit: true,
      stock: true,
    },
  },
} satisfies Prisma.RackSelect;

export type RawRackContents = Prisma.RackGetPayload<{
  select: typeof RACK_CONTENTS_SELECT;
}>;

const LOW_STOCK_LOCATION_SELECT = {
  id: true,
  name: true,
  code: true,
  stock: true,
  minStock: true,
  unit: true,
  category: { select: { name: true } },
  defaultRack: {
    select: {
      code: true,
      name: true,
      location: true,
      branch: { select: { name: true } },
    },
  },
} satisfies Prisma.ProductSelect;

export type RawLowStockLocation = Prisma.ProductGetPayload<{
  select: typeof LOW_STOCK_LOCATION_SELECT;
}>;

const SUPPLIER_SELECT = {
  id: true,
  name: true,
  contact: true,
  email: true,
  address: true,
} satisfies Prisma.SupplierSelect;

export type RawSupplier = Prisma.SupplierGetPayload<{
  select: typeof SUPPLIER_SELECT;
}>;

const RESTOCK_PRODUCT_SELECT = {
  id: true,
  name: true,
  code: true,
  stock: true,
  minStock: true,
  purchasePrice: true,
  unit: true,
  supplier: { select: { id: true, name: true } },
} satisfies Prisma.ProductSelect;

export type RawRestockProduct = Prisma.ProductGetPayload<{
  select: typeof RESTOCK_PRODUCT_SELECT;
}>;

const PO_PRODUCT_SELECT = {
  id: true,
  code: true,
  name: true,
} satisfies Prisma.ProductSelect;

export type RawPOProduct = Prisma.ProductGetPayload<{
  select: typeof PO_PRODUCT_SELECT;
}>;

@Injectable()
export class AiAssistantRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Top products ─────────────────────────────────────────────────

  async groupTopProducts(
    where: Prisma.TransactionItemWhereInput,
    limit: number,
  ) {
    return this.prisma.transactionItem.groupBy({
      by: ["productName", "productCode"],
      _sum: { quantity: true, subtotal: true },
      where,
      orderBy: { _sum: { quantity: "desc" } },
      take: limit,
    });
  }

  // ── Slow products ────────────────────────────────────────────────

  async groupSoldProductIds(companyId: string | null, since: Date) {
    return this.prisma.transactionItem.groupBy({
      by: ["productId"],
      where: {
        transaction: {
          status: "COMPLETED",
          createdAt: { gte: since },
          ...(companyId ? { user: { companyId } } : {}),
        },
      },
    });
  }

  async findSlowProducts(
    companyId: string | null,
    soldIds: string[],
    limit: number,
  ): Promise<RawSlowProduct[]> {
    return this.prisma.product.findMany({
      where: {
        isActive: true,
        id: { notIn: soldIds },
        ...(companyId ? { companyId } : {}),
      },
      select: SLOW_PRODUCT_SELECT,
      take: limit,
      orderBy: { stock: "desc" },
    });
  }

  // ── Sales summary ────────────────────────────────────────────────

  async aggregateSales(where: Prisma.TransactionWhereInput) {
    return this.prisma.transaction.aggregate({
      _sum: { grandTotal: true, discountAmount: true, taxAmount: true },
      where,
    });
  }

  async countTransactions(where: Prisma.TransactionWhereInput) {
    return this.prisma.transaction.count({ where });
  }

  // ── Low stock (raw SQL) ──────────────────────────────────────────

  async findLowStockRaw(
    companyId: string | null,
    limit: number,
  ): Promise<RawLowStockProduct[]> {
    return this.prisma.$queryRawUnsafe<RawLowStockProduct[]>(
      `
      SELECT p.id, p.name, p.code, p.stock, p."minStock", p.unit,
             p."sellingPrice", p."purchasePrice",
             s.name as "supplierName", s.id as "supplierId",
             c.name as "categoryName"
      FROM products p
      LEFT JOIN suppliers s ON p."supplierId" = s.id
      LEFT JOIN categories c ON p."categoryId" = c.id
      WHERE p."isActive" = true AND p.stock <= p."minStock"
        AND ($2::text IS NULL OR p."companyId" = $2)
      ORDER BY p.stock ASC
      LIMIT $1
      `,
      limit,
      companyId,
    );
  }

  // ── PO product lookup ────────────────────────────────────────────

  async findProductsByIds(
    ids: string[],
    companyId: string,
  ): Promise<RawPOProduct[]> {
    return this.prisma.product.findMany({
      where: { id: { in: ids }, companyId },
      select: PO_PRODUCT_SELECT,
    });
  }

  // ── Restock recommendation ───────────────────────────────────────

  async groupSalesData(companyId: string | null, since: Date) {
    return this.prisma.transactionItem.groupBy({
      by: ["productId"],
      _sum: { quantity: true },
      where: {
        transaction: {
          status: "COMPLETED",
          createdAt: { gte: since },
          ...(companyId ? { user: { companyId } } : {}),
        },
      },
    });
  }

  async findActiveProducts(
    companyId: string | null,
  ): Promise<RawRestockProduct[]> {
    return this.prisma.product.findMany({
      where: { isActive: true, ...(companyId ? { companyId } : {}) },
      select: RESTOCK_PRODUCT_SELECT,
    });
  }

  // ── Search products ──────────────────────────────────────────────

  async searchProducts(
    companyId: string | null,
    query: string,
  ): Promise<RawSearchProduct[]> {
    return this.prisma.product.findMany({
      where: {
        ...(companyId ? { companyId } : {}),
        isActive: true,
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { code: { contains: query, mode: "insensitive" } },
        ],
      },
      select: SEARCH_PRODUCT_SELECT,
      take: 10,
    });
  }

  // ── Find product location ────────────────────────────────────────

  async findProductLocations(
    companyId: string | null,
    query: string,
  ): Promise<RawProductLocation[]> {
    return this.prisma.product.findMany({
      where: {
        ...(companyId ? { companyId } : {}),
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { code: { contains: query, mode: "insensitive" } },
        ],
      },
      select: PRODUCT_LOCATION_SELECT,
      take: 5,
    });
  }

  // ── Lookup rack contents ─────────────────────────────────────────

  async findRackContents(
    companyId: string | null,
    query: string,
  ): Promise<RawRackContents[]> {
    return this.prisma.rack.findMany({
      where: {
        ...(companyId ? { companyId } : {}),
        OR: [
          { code: { contains: query, mode: "insensitive" } },
          { name: { contains: query, mode: "insensitive" } },
        ],
      },
      select: RACK_CONTENTS_SELECT,
      take: 5,
    });
  }

  // ── Low stock with location ──────────────────────────────────────

  async findLowStockWithLocation(
    companyId: string | null,
    limit: number,
  ): Promise<RawLowStockLocation[]> {
    return this.prisma.product.findMany({
      where: {
        ...(companyId ? { companyId } : {}),
        isActive: true,
      },
      select: LOW_STOCK_LOCATION_SELECT,
      orderBy: { stock: "asc" },
      take: limit * 2, // overscan, filter later
    });
  }

  // ── Suppliers ────────────────────────────────────────────────────

  async findActiveSuppliers(
    companyId: string | null,
  ): Promise<RawSupplier[]> {
    return this.prisma.supplier.findMany({
      where: { isActive: true, ...(companyId ? { companyId } : {}) },
      select: SUPPLIER_SELECT,
      orderBy: { name: "asc" },
    });
  }

  // ── Category sales (raw SQL) ─────────────────────────────────────

  async getCategorySalesRaw(
    companyId: string | null,
    since: Date,
  ): Promise<RawCategorySalesRow[]> {
    return this.prisma.$queryRawUnsafe<RawCategorySalesRow[]>(
      `
      SELECT COALESCE(c.name, 'Tanpa Kategori') as name,
             SUM(ti.quantity)::bigint as qty,
             SUM(ti.subtotal)::bigint as revenue,
             COUNT(*)::bigint as items
      FROM transaction_items ti
      JOIN transactions t ON t.id = ti."transactionId"
      JOIN users u ON u.id = t."userId"
      JOIN products p ON p.id = ti."productId"
      LEFT JOIN categories c ON c.id = p."categoryId"
      WHERE t.status = 'COMPLETED' AND t."createdAt" >= $1
        AND ($2::text IS NULL OR u."companyId" = $2)
      GROUP BY c.name
      ORDER BY revenue DESC
      `,
      since,
      companyId,
    );
  }

  // ── Audit log percakapan AI Asisten ─────────────────────────────

  // Catat satu interaksi AI ke ai_assistant_logs. Di-wrap try/catch supaya
  // kegagalan logging TIDAK PERNAH menggagalkan respons AI ke user.
  async createConversationLog(data: {
    companyId: string | null;
    userId: string;
    userName: string | null;
    role: string | null;
    question: string;
    answer: string | null;
    status: string;
    toolsUsed: string[];
    errorMessage: string | null;
    durationMs: number | null;
  }): Promise<void> {
    try {
      await this.prisma.aiAssistantLog.create({ data });
    } catch {
      // sengaja ditelan — audit log bersifat best-effort.
    }
  }

  // List audit log percakapan (untuk endpoint audit). Scoped per-company.
  async listConversationLogs(
    companyId: string | null,
    opts: { status?: string; days?: number; limit: number; offset: number },
  ) {
    const where: Prisma.AiAssistantLogWhereInput = {};
    if (companyId) where.companyId = companyId;
    if (opts.status) where.status = opts.status;
    if (opts.days) {
      const since = new Date();
      since.setDate(since.getDate() - opts.days);
      where.createdAt = { gte: since };
    }
    const [rows, total] = await Promise.all([
      this.prisma.aiAssistantLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: opts.limit,
        skip: opts.offset,
      }),
      this.prisma.aiAssistantLog.count({ where }),
    ]);
    return { rows, total };
  }

  // ── Analytics scoped per-company (dashboard, payment, meja, profit) ──

  // Scope transaksi ke company (lewat user.companyId, sama seperti modul
  // dashboard) + COMPLETED + rentang waktu + optional branch.
  private scopedTxWhere(
    companyId: string | null,
    from: Date,
    to: Date,
    branchId?: string,
  ): Prisma.TransactionWhereInput {
    const w: Prisma.TransactionWhereInput = {
      status: "COMPLETED",
      createdAt: { gte: from, lte: to },
    };
    if (companyId) w.user = { companyId };
    if (branchId) w.branchId = branchId;
    return w;
  }

  async aggregateSalesScoped(
    companyId: string | null,
    from: Date,
    to: Date,
    branchId?: string,
  ) {
    return this.prisma.transaction.aggregate({
      where: this.scopedTxWhere(companyId, from, to, branchId),
      _sum: { grandTotal: true, discountAmount: true, taxAmount: true },
      _count: { _all: true },
    });
  }

  async groupPaymentMethods(
    companyId: string | null,
    from: Date,
    to: Date,
    branchId?: string,
  ) {
    return this.prisma.transaction.groupBy({
      by: ["paymentMethod"],
      where: this.scopedTxWhere(companyId, from, to, branchId),
      _sum: { grandTotal: true },
      _count: { _all: true },
      orderBy: { _sum: { grandTotal: "desc" } },
    });
  }

  async topProductScoped(
    companyId: string | null,
    from: Date,
    to: Date,
    branchId: string | undefined,
    limit: number,
  ) {
    return this.prisma.transactionItem.groupBy({
      by: ["productName", "productCode"],
      where: { transaction: this.scopedTxWhere(companyId, from, to, branchId) },
      _sum: { quantity: true, subtotal: true },
      orderBy: { _sum: { subtotal: "desc" } },
      take: limit,
    });
  }

  // ── Meja / table status ──────────────────────────────────────────

  async tableStatusList(companyId: string | null, branchId?: string) {
    return this.prisma.restaurantTable.findMany({
      where: {
        isActive: true,
        ...(branchId ? { branchId } : {}),
        ...(companyId ? { branch: { companyId } } : {}),
      },
      select: {
        id: true,
        number: true,
        name: true,
        status: true,
        section: true,
        capacity: true,
        isOnline: true,
        branch: { select: { name: true } },
        tableSessions: {
          where: { status: { in: ["OPEN", "AWAITING_PAYMENT"] } },
          select: {
            status: true,
            customerName: true,
            customerPhone: true,
            subtotal: true,
            openedAt: true,
          },
          orderBy: { openedAt: "desc" },
          take: 1,
        },
      },
      orderBy: [{ sortOrder: "asc" }, { number: "asc" }],
    });
  }

  async busiestTablesRaw(
    companyId: string | null,
    from: Date,
    to: Date,
    limit: number,
  ): Promise<
    {
      number: number;
      name: string | null;
      section: string | null;
      branch: string;
      txCount: bigint;
      revenue: number;
    }[]
  > {
    return this.prisma.$queryRawUnsafe(
      `
      SELECT rt.number, rt.name, rt.section, b.name as branch,
             COUNT(t.id)::bigint as "txCount",
             COALESCE(SUM(t."grandTotal"), 0)::float as revenue
      FROM transactions t
      JOIN restaurant_tables rt ON rt.id = t."tableId"
      JOIN users u ON u.id = t."userId"
      LEFT JOIN branches b ON b.id = rt."branchId"
      WHERE t.status = 'COMPLETED'
        AND t."createdAt" >= $1 AND t."createdAt" <= $2
        AND ($3::text IS NULL OR u."companyId" = $3)
      GROUP BY rt.number, rt.name, rt.section, b.name
      ORDER BY revenue DESC
      LIMIT $4
      `,
      from,
      to,
      companyId,
      limit,
    );
  }

  // ── Tren penjualan harian ────────────────────────────────────────

  async salesTrendRaw(
    companyId: string | null,
    from: Date,
    to: Date,
    branchId?: string,
  ): Promise<
    { date: string; txCount: bigint; revenue: number }[]
  > {
    return this.prisma.$queryRawUnsafe(
      `
      SELECT to_char(t."createdAt" AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') as date,
             COUNT(*)::bigint as "txCount",
             COALESCE(SUM(t."grandTotal"), 0)::float as revenue
      FROM transactions t
      JOIN users u ON u.id = t."userId"
      WHERE t.status = 'COMPLETED'
        AND t."createdAt" >= $1 AND t."createdAt" <= $2
        AND ($3::text IS NULL OR u."companyId" = $3)
        AND ($4::text IS NULL OR t."branchId" = $4)
      GROUP BY 1
      ORDER BY 1
      `,
      from,
      to,
      companyId,
      branchId ?? null,
    );
  }

  // ── Ringkasan laba (estimasi: COGS pakai purchasePrice produk saat ini) ──

  async profitSummaryRaw(
    companyId: string | null,
    from: Date,
    to: Date,
    branchId?: string,
  ): Promise<{ revenue: number; cogs: number; txCount: bigint }[]> {
    return this.prisma.$queryRawUnsafe(
      `
      SELECT
        COALESCE(SUM(ti.subtotal), 0)::float as revenue,
        COALESCE(SUM(COALESCE(ti."baseQty", ti.quantity * ti."conversionQty") * p."purchasePrice"), 0)::float as cogs,
        COUNT(DISTINCT t.id)::bigint as "txCount"
      FROM transaction_items ti
      JOIN transactions t ON t.id = ti."transactionId"
      JOIN products p ON p.id = ti."productId"
      JOIN users u ON u.id = t."userId"
      WHERE t.status = 'COMPLETED'
        AND t."createdAt" >= $1 AND t."createdAt" <= $2
        AND ($3::text IS NULL OR u."companyId" = $3)
        AND ($4::text IS NULL OR t."branchId" = $4)
      `,
      from,
      to,
      companyId,
      branchId ?? null,
    );
  }
}
