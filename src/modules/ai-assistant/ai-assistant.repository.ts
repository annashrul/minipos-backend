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

  async groupSoldProductIds(since: Date) {
    return this.prisma.transactionItem.groupBy({
      by: ["productId"],
      where: {
        transaction: { status: "COMPLETED", createdAt: { gte: since } },
      },
    });
  }

  async findSlowProducts(
    soldIds: string[],
    limit: number,
  ): Promise<RawSlowProduct[]> {
    return this.prisma.product.findMany({
      where: { isActive: true, id: { notIn: soldIds } },
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

  async findLowStockRaw(limit: number): Promise<RawLowStockProduct[]> {
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
      ORDER BY p.stock ASC
      LIMIT $1
      `,
      limit,
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

  async groupSalesData(since: Date) {
    return this.prisma.transactionItem.groupBy({
      by: ["productId"],
      _sum: { quantity: true },
      where: {
        transaction: { status: "COMPLETED", createdAt: { gte: since } },
      },
    });
  }

  async findActiveProducts(): Promise<RawRestockProduct[]> {
    return this.prisma.product.findMany({
      where: { isActive: true },
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

  async findActiveSuppliers(): Promise<RawSupplier[]> {
    return this.prisma.supplier.findMany({
      where: { isActive: true },
      select: SUPPLIER_SELECT,
      orderBy: { name: "asc" },
    });
  }

  // ── Category sales (raw SQL) ─────────────────────────────────────

  async getCategorySalesRaw(since: Date): Promise<RawCategorySalesRow[]> {
    return this.prisma.$queryRawUnsafe<RawCategorySalesRow[]>(
      `
      SELECT COALESCE(c.name, 'Tanpa Kategori') as name,
             SUM(ti.quantity)::bigint as qty,
             SUM(ti.subtotal)::bigint as revenue,
             COUNT(*)::bigint as items
      FROM transaction_items ti
      JOIN transactions t ON t.id = ti."transactionId"
      JOIN products p ON p.id = ti."productId"
      LEFT JOIN categories c ON c.id = p."categoryId"
      WHERE t.status = 'COMPLETED' AND t."createdAt" >= $1
      GROUP BY c.name
      ORDER BY revenue DESC
      `,
      since,
    );
  }
}
