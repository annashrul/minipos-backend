import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AiChatMessageDto, AiChatResponse } from "@/contracts";
import Groq from "groq-sdk";
import { PrismaService } from "../prisma/prisma.service";
import { CashierService } from "../cashier/cashier.service";
import { PurchasesService } from "../purchases/purchases.service";

// OpenAI-compatible tool definitions for Groq
const TOOLS: Groq.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_top_products",
      description: "Mendapatkan produk terlaris berdasarkan penjualan.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Jumlah produk (default 10)" },
          days: { type: "number", description: "Hari ke belakang (default 30)" },
          branchId: { type: "string", description: "ID cabang" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_slow_products",
      description: "Mendapatkan produk yang lambat/tidak terjual.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "Hari ke belakang (default 30)" },
          limit: { type: "number", description: "Jumlah (default 10)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_sales_summary",
      description:
        "Ringkasan penjualan (revenue, transaksi) untuk periode tertentu.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", description: "today/week/month/year" },
          branchId: { type: "string", description: "ID cabang" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_low_stock",
      description: "Produk yang stoknya menipis atau habis.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Jumlah (default 20)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_cashier_performance",
      description: "Performa kasir (revenue, transaksi, rata-rata).",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", description: "today/week/month" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_purchase_order",
      description: "Membuat Purchase Order baru ke supplier.",
      parameters: {
        type: "object",
        properties: {
          supplierId: { type: "string", description: "ID supplier" },
          items: {
            type: "array",
            description: "Daftar item",
            items: {
              type: "object",
              properties: {
                productId: { type: "string" },
                productName: { type: "string" },
                quantity: { type: "number" },
                unitPrice: { type: "number" },
              },
              required: ["productId", "productName", "quantity", "unitPrice"],
            },
          },
          notes: { type: "string", description: "Catatan" },
        },
        required: ["supplierId", "items"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_restock_recommendation",
      description:
        "Rekomendasi restock berdasarkan data penjualan dan stok.",
      parameters: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description: "Analisa X hari terakhir (default 30)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_products",
      description: "Mencari produk berdasarkan nama atau kode.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Kata kunci" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_suppliers",
      description: "Daftar supplier aktif.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_category_sales",
      description: "Penjualan per kategori.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "Jumlah hari (default 30)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_product_location",
      description:
        "Cari LOKASI FISIK produk di rak. WAJIB dipakai saat user nanya 'dimana letak X', 'rak mana barang Y', 'cariin oli vario', 'mekanik minta aki PCX dimana taruhnya'. Return: kode rak, nama rak, lokasi fisik, qty di tiap rak, total stok per cabang.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Nama atau kode produk yang dicari (mis. 'oli matic', 'AKI-005', 'busi vario')",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_rack_contents",
      description:
        "Lihat isi rak. Pakai saat user nanya 'apa isi rak AK-01', 'produk apa di rak roller', 'tampilkan stok rak X'. Bisa cari by kode rak atau nama rak.",
      parameters: {
        type: "object",
        properties: {
          rackQuery: {
            type: "string",
            description:
              "Kode rak (mis. 'AK-01') atau nama rak (mis. 'rak roller', 'oli matic')",
          },
        },
        required: ["rackQuery"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_low_stock_with_location",
      description:
        "Produk stok menipis BERIKUT lokasi rak-nya. Dipakai saat user nanya 'stok apa yang habis dan dimana letaknya', 'produk hampir habis di rak mana'.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Jumlah produk (default 20)",
          },
        },
      },
    },
  },
];

type AuthContext = {
  userId: string;
  userName: string;
  role: string;
  companyId: string | null;
};

@Injectable()
export class AiAssistantService {
  private readonly logger = new Logger(AiAssistantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly cashier: CashierService,
    private readonly purchases: PurchasesService,
  ) {}

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Tool executors
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private async executeGetTopProducts(input: {
    limit?: number;
    days?: number;
    branchId?: string;
  }) {
    const days = input.days || 30;
    const limit = input.limit || 10;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const where: Record<string, unknown> = {
      transaction: { status: "COMPLETED", createdAt: { gte: since } },
    };
    if (input.branchId) {
      where.transaction = {
        ...(where.transaction as object),
        branchId: input.branchId,
      };
    }

    const items = await this.prisma.transactionItem.groupBy({
      by: ["productName", "productCode"],
      _sum: { quantity: true, subtotal: true },
      where,
      orderBy: { _sum: { quantity: "desc" } },
      take: limit,
    });

    return items.map((i, idx) => ({
      rank: idx + 1,
      name: i.productName,
      code: i.productCode,
      totalQty: i._sum.quantity || 0,
      totalRevenue: i._sum.subtotal || 0,
    }));
  }

  private async executeGetSlowProducts(input: {
    days?: number;
    limit?: number;
  }) {
    const days = input.days || 30;
    const limit = input.limit || 10;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const soldProducts = await this.prisma.transactionItem.groupBy({
      by: ["productId"],
      where: {
        transaction: { status: "COMPLETED", createdAt: { gte: since } },
      },
    });
    const soldIds = soldProducts.map((p) => p.productId);

    const slow = await this.prisma.product.findMany({
      where: { isActive: true, id: { notIn: soldIds } },
      select: {
        id: true,
        name: true,
        code: true,
        stock: true,
        sellingPrice: true,
        purchasePrice: true,
        unit: true,
        category: { select: { name: true } },
      },
      take: limit,
      orderBy: { stock: "desc" },
    });

    return slow.map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      stock: p.stock,
      sellingPrice: p.sellingPrice,
      purchasePrice: p.purchasePrice,
      unit: p.unit,
      category: p.category?.name || "Tanpa Kategori",
      daysSinceLastSale: `Tidak terjual dalam ${days} hari terakhir`,
    }));
  }

  private async executeGetSalesSummary(input: {
    period?: string;
    branchId?: string;
  }) {
    const period = input.period || "month";
    const now = new Date();
    let start: Date;

    if (period === "today") {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (period === "week") {
      start = new Date(now);
      start.setDate(now.getDate() - 7);
    } else if (period === "year") {
      start = new Date(now.getFullYear(), 0, 1);
    } else {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const where: Record<string, unknown> = {
      status: "COMPLETED",
      createdAt: { gte: start },
    };
    if (input.branchId) where.branchId = input.branchId;

    const [agg, count] = await Promise.all([
      this.prisma.transaction.aggregate({
        _sum: { grandTotal: true, discountAmount: true, taxAmount: true },
        where,
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return {
      period,
      revenue: agg._sum.grandTotal || 0,
      discount: agg._sum.discountAmount || 0,
      tax: agg._sum.taxAmount || 0,
      transactions: count,
      averageTicket:
        count > 0 ? Math.round(Number(agg._sum.grandTotal || 0) / count) : 0,
    };
  }

  private async executeGetLowStock(input: { limit?: number }) {
    const limit = input.limit || 20;

    const products = await this.prisma.$queryRawUnsafe<
      {
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
      }[]
    >(
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

    return products.map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      stock: p.stock,
      minStock: p.minStock,
      unit: p.unit,
      sellingPrice: p.sellingPrice,
      purchasePrice: p.purchasePrice,
      supplier: p.supplierName || "Tidak ada supplier",
      supplierId: p.supplierId,
      category: p.categoryName || "Tanpa Kategori",
      deficit: p.minStock - p.stock,
    }));
  }

  private async executeGetCashierPerformance(
    auth: AuthContext,
    input: { period?: string },
  ) {
    if (!auth.companyId) return [];

    const period = (input.period as "today" | "week" | "month") || "month";
    const now = new Date();
    let start: Date;
    let end: Date;

    if (period === "today") {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      end = now;
    } else if (period === "week") {
      start = new Date(now);
      start.setDate(now.getDate() - 7);
      end = now;
    } else {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = now;
    }

    const result = await this.cashier.getPerformance(auth.companyId, {
      from: start.toISOString(),
      to: end.toISOString(),
    } as Parameters<CashierService["getPerformance"]>[1]);

    return result.performance.map((c) => ({
      name: c.userName,
      revenue: c.totalSales,
      transactions: c.totalTransactions,
      averageTicket: c.avgTransaction,
      hoursWorked: c.hoursWorked,
      salesPerHour: c.salesPerHour,
    }));
  }

  private async executeCreatePurchaseOrder(
    auth: AuthContext,
    input: {
      supplierId: string;
      items: {
        productId: string;
        productName: string;
        quantity: number;
        unitPrice: number;
      }[];
      notes?: string;
    },
  ) {
    if (!auth.companyId) {
      return { error: "No company context" };
    }

    // Need productCode + subtotal for the API DTO; load missing fields from products.
    const productIds = input.items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, companyId: auth.companyId },
      select: { id: true, code: true, name: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    const items = input.items.map((it) => {
      const p = productMap.get(it.productId);
      return {
        productId: it.productId,
        productName: p?.name ?? it.productName,
        productCode: p?.code ?? "",
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        subtotal: it.quantity * it.unitPrice,
      };
    });

    const created = await this.purchases.create(auth.companyId, auth.userId, {
      supplierId: input.supplierId,
      items,
      notes: input.notes ?? null,
    });

    return created;
  }

  private async executeGetRestockRecommendation(input: { days?: number }) {
    const days = input.days || 30;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const [salesData, products] = await Promise.all([
      this.prisma.transactionItem.groupBy({
        by: ["productId"],
        _sum: { quantity: true },
        where: {
          transaction: { status: "COMPLETED", createdAt: { gte: since } },
        },
      }),
      this.prisma.product.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          code: true,
          stock: true,
          minStock: true,
          purchasePrice: true,
          unit: true,
          supplier: { select: { id: true, name: true } },
        },
      }),
    ]);

    const salesMap = new Map(
      salesData.map((s) => [s.productId, s._sum.quantity || 0]),
    );

    return products
      .map((p) => {
        const sold = salesMap.get(p.id) || 0;
        const dailyAvg = sold / days;
        const daysLeft = dailyAvg > 0 ? Math.round(p.stock / dailyAvg) : 999;
        const suggestedQty = Math.max(0, Math.ceil(dailyAvg * 30) - p.stock);
        return {
          id: p.id,
          name: p.name,
          code: p.code,
          stock: p.stock,
          minStock: p.minStock,
          unit: p.unit,
          purchasePrice: p.purchasePrice,
          supplierId: p.supplier?.id || null,
          supplierName: p.supplier?.name || "Tidak ada supplier",
          soldLast30d: sold,
          dailyAvg: Math.round(dailyAvg * 10) / 10,
          daysLeft,
          suggestedQty,
          estimatedCost: suggestedQty * Number(p.purchasePrice),
        };
      })
      .filter((p) => p.suggestedQty > 0 || p.stock <= p.minStock)
      .sort((a, b) => a.daysLeft - b.daysLeft)
      .slice(0, 20);
  }

  private async executeSearchProducts(
    auth: AuthContext,
    input: { query: string },
  ) {
    const q = input.query || "";
    const products = await this.prisma.product.findMany({
      where: {
        ...(auth.companyId ? { companyId: auth.companyId } : {}),
        isActive: true,
        deletedAt: null,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { code: { contains: q, mode: "insensitive" } },
        ],
      },
      select: {
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
      },
      take: 10,
    });

    return products.map((p) => ({
      id: p.id,
      name: p.name,
      code: p.code,
      stock: p.stock,
      sellingPrice: p.sellingPrice,
      purchasePrice: p.purchasePrice,
      unit: p.unit,
      minStock: p.minStock,
      category: p.category?.name || "Tanpa Kategori",
      supplierId: p.supplier?.id || null,
      supplierName: p.supplier?.name || "Tidak ada supplier",
      defaultRack: p.defaultRack
        ? {
            code: p.defaultRack.code,
            name: p.defaultRack.name,
            location: p.defaultRack.location,
            branch: p.defaultRack.branch.name,
          }
        : null,
    }));
  }

  /**
   * Find LOKASI FISIK produk di rak. Return detail per-rak (bukan cuma
   * defaultRackId) — termasuk qty actual di tiap rak, plus default rack.
   */
  private async executeFindProductLocation(
    auth: AuthContext,
    input: { query: string },
  ) {
    const q = input.query || "";
    const products = await this.prisma.product.findMany({
      where: {
        ...(auth.companyId ? { companyId: auth.companyId } : {}),
        deletedAt: null,
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { code: { contains: q, mode: "insensitive" } },
        ],
      },
      select: {
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
      },
      take: 5,
    });

    if (products.length === 0) {
      return {
        found: false,
        message: `Tidak ada produk yang cocok dengan "${q}"`,
      };
    }

    return {
      found: true,
      products: products.map((p) => ({
        code: p.code,
        name: p.name,
        category: p.category?.name ?? null,
        unit: p.unit,
        sellingPrice: p.sellingPrice,
        totalStock: p.stock,
        defaultLocation: p.defaultRack
          ? {
              rackCode: p.defaultRack.code,
              rackName: p.defaultRack.name,
              location: p.defaultRack.location,
              branch: p.defaultRack.branch.name,
            }
          : null,
        racks: p.rackStocks.map((rs) => ({
          rackCode: rs.rack.code,
          rackName: rs.rack.name,
          location: rs.rack.location,
          branch: rs.rack.branch.name,
          qty: rs.qty,
          isDefault: rs.rack.id === p.defaultRack?.id,
        })),
        stockPerBranch: p.branchStocks.map((bs) => ({
          branch: bs.branch.name,
          quantity: bs.quantity,
        })),
      })),
    };
  }

  /**
   * Lookup isi rak by kode atau nama. Return produk-produk yang ada di rak,
   * qty masing-masing, info rak.
   */
  private async executeLookupRackContents(
    auth: AuthContext,
    input: { rackQuery: string },
  ) {
    const q = input.rackQuery || "";
    const racks = await this.prisma.rack.findMany({
      where: {
        ...(auth.companyId ? { companyId: auth.companyId } : {}),
        OR: [
          { code: { contains: q, mode: "insensitive" } },
          { name: { contains: q, mode: "insensitive" } },
        ],
      },
      select: {
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
          orderBy: { qty: "desc" },
        },
        defaultForProducts: {
          where: { deletedAt: null },
          select: {
            code: true,
            name: true,
            unit: true,
            stock: true,
          },
        },
      },
      take: 5,
    });

    if (racks.length === 0) {
      return {
        found: false,
        message: `Tidak ada rak dengan kode/nama "${q}"`,
      };
    }

    return {
      found: true,
      racks: racks.map((r) => {
        const itemsWithStock = r.rackStocks.map((rs) => ({
          productCode: rs.product.code,
          productName: rs.product.name,
          category: rs.product.category?.name ?? null,
          unit: rs.product.unit,
          qty: rs.qty,
        }));
        const stockProductCodes = new Set(itemsWithStock.map((i) => i.productCode));
        const defaultOnly = r.defaultForProducts
          .filter((p) => !stockProductCodes.has(p.code))
          .map((p) => ({
            productCode: p.code,
            productName: p.name,
            unit: p.unit,
            qty: 0,
            note: "default rak, qty rak 0",
          }));
        return {
          rackCode: r.code,
          rackName: r.name,
          location: r.location,
          branch: r.branch.name,
          isActive: r.isActive,
          totalItems: itemsWithStock.length + defaultOnly.length,
          totalQty: itemsWithStock.reduce((s, i) => s + i.qty, 0),
          items: [...itemsWithStock, ...defaultOnly],
        };
      }),
    };
  }

  /**
   * Produk stok menipis dengan info rak.
   */
  private async executeFindLowStockWithLocation(
    auth: AuthContext,
    input: { limit?: number },
  ) {
    const limit = input.limit || 20;
    const lowStock = await this.prisma.product.findMany({
      where: {
        ...(auth.companyId ? { companyId: auth.companyId } : {}),
        isActive: true,
        deletedAt: null,
      },
      select: {
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
      },
      orderBy: { stock: "asc" },
      take: limit * 2, // overscan, filter later
    });

    const filtered = lowStock
      .filter((p) => p.stock <= p.minStock)
      .slice(0, limit);

    return filtered.map((p) => ({
      code: p.code,
      name: p.name,
      category: p.category?.name ?? null,
      stock: p.stock,
      minStock: p.minStock,
      unit: p.unit,
      isOutOfStock: p.stock === 0,
      location: p.defaultRack
        ? {
            rackCode: p.defaultRack.code,
            rackName: p.defaultRack.name,
            location: p.defaultRack.location,
            branch: p.defaultRack.branch.name,
          }
        : null,
    }));
  }

  private async executeGetSuppliers() {
    return this.prisma.supplier.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        contact: true,
        email: true,
        address: true,
      },
      orderBy: { name: "asc" },
    });
  }

  private async executeGetCategorySales(input: { days?: number }) {
    const days = input.days || 30;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const rows = await this.prisma.$queryRawUnsafe<
      { name: string; qty: bigint; revenue: bigint; items: bigint }[]
    >(
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

    return rows.map((r) => ({
      category: r.name,
      totalQuantity: Number(r.qty),
      totalRevenue: Number(r.revenue),
      totalItems: Number(r.items),
    }));
  }

  private async executeTool(
    auth: AuthContext,
    name: string,
    input: Record<string, unknown>,
  ) {
    try {
      switch (name) {
        case "get_top_products":
          return await this.executeGetTopProducts(
            input as { limit?: number; days?: number; branchId?: string },
          );
        case "get_slow_products":
          return await this.executeGetSlowProducts(
            input as { days?: number; limit?: number },
          );
        case "get_sales_summary":
          return await this.executeGetSalesSummary(
            input as { period?: string; branchId?: string },
          );
        case "get_low_stock":
          return await this.executeGetLowStock(input as { limit?: number });
        case "get_cashier_performance":
          return await this.executeGetCashierPerformance(
            auth,
            input as { period?: string },
          );
        case "create_purchase_order":
          return await this.executeCreatePurchaseOrder(
            auth,
            input as {
              supplierId: string;
              items: {
                productId: string;
                productName: string;
                quantity: number;
                unitPrice: number;
              }[];
              notes?: string;
            },
          );
        case "get_restock_recommendation":
          return await this.executeGetRestockRecommendation(
            input as { days?: number },
          );
        case "search_products":
          return await this.executeSearchProducts(
            auth,
            input as { query: string },
          );
        case "get_suppliers":
          return await this.executeGetSuppliers();
        case "get_category_sales":
          return await this.executeGetCategorySales(input as { days?: number });
        case "find_product_location":
          return await this.executeFindProductLocation(
            auth,
            input as { query: string },
          );
        case "lookup_rack_contents":
          return await this.executeLookupRackContents(
            auth,
            input as { rackQuery: string },
          );
        case "find_low_stock_with_location":
          return await this.executeFindLowStockWithLocation(
            auth,
            input as { limit?: number },
          );
        default:
          return { error: `Tool '${name}' not found` };
      }
    } catch (error) {
      this.logger.error(
        `[AI Tool Error] ${name}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return {
        error: `Gagal menjalankan tool '${name}': ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Public API
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async chat(
    auth: AuthContext,
    messages: AiChatMessageDto[],
  ): Promise<AiChatResponse> {
    const systemPrompt = `Kamu adalah asisten AI untuk aplikasi POS/Bengkel "NusaPOS". Kamu WAJIB pakai tools yang tersedia untuk menjawab pertanyaan tentang data toko. JANGAN PERNAH mengarang data.

ATURAN KETAT:
1. Pertanyaan tentang produk, stok, lokasi rak, penjualan, kasir, supplier, kategori -> WAJIB panggil tool dulu
2. JANGAN mengarang angka, nama produk, kode rak, atau data apapun tanpa tool call
3. Jika tidak ada tool yang cocok, jawab "Maaf, saya tidak punya akses ke data tersebut"
4. Bahasa Indonesia, ringkas, langsung ke jawabannya. JANGAN bertele-tele.
5. Format angka uang dengan Rp (contoh: Rp 150.000)
6. WAJIB pakai find_product_location saat user nanya LOKASI/POSISI produk ("dimana", "rak mana", "ada di mana", "letak", "cariin")
7. WAJIB pakai lookup_rack_contents saat user nanya ISI RAK ("apa isi rak X", "produk apa di rak Y", "tampilkan rak Z")
8. find_low_stock_with_location lebih baik daripada get_low_stock karena include lokasi rak
9. Saat buat PO, panggil get_restock_recommendation + get_suppliers dulu

CONTOH ALUR:
- "Dimana oli Yamalube?" -> find_product_location("oli yamalube") -> "Oli Yamalube Power Matic ada di rak OL-02 (Sintetik/Premium). Tersedia 25 botol."
- "Mekanik minta aki Vario, dimana?" -> find_product_location("aki vario") -> Jawab dengan kode rak + qty
- "Apa isi rak BU-01?" -> lookup_rack_contents("BU-01") -> Daftar produk di rak itu
- "Produk apa yang hampir habis?" -> find_low_stock_with_location -> Sertakan lokasi rak
- "Cari oli matic" -> find_product_location("oli matic")
- "Berapa stok busi NGK CR8E?" -> find_product_location("busi NGK CR8E")

FORMAT JAWABAN UNTUK LOOKUP LOKASI:
Sertakan: nama produk, kode rak, sub-section/nama rak, qty. Format ringkas.
Contoh: "AHM Oil SPX2 Matic 0.8L (OLI-007) - Rak OL-01 (Matic 0.8L), tersedia 40 botol."

Info user: ${auth.userName} (${auth.role})`;

    const apiKey = this.config.get<string>("GROQ_API_KEY");
    // OpenAI gpt-oss-120b di Groq punya tool-calling jauh lebih reliable
    // dibanding Llama-3 family (yang kadang emit native function-tag format
    // `<function=name={args}>` alih-alih JSON, bikin Groq API reject dgn
    // "tool call validation failed"). Set GROQ_MODEL di .env untuk override.
    const model =
      this.config.get<string>("GROQ_MODEL") || "openai/gpt-oss-120b";

    if (!apiKey) {
      return {
        error:
          "GROQ_API_KEY belum dikonfigurasi. Dapatkan gratis di console.groq.com",
      };
    }

    const groq = new Groq({ apiKey });

    try {
      const chatMessages: Groq.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        ...messages.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ];

      let response = await groq.chat.completions.create({
        model,
        messages: chatMessages,
        tools: TOOLS,
        tool_choice: "auto",
        max_tokens: 4096,
      });

      // Handle tool calls in a loop (max 5 iterations)
      let iterations = 0;
      while (iterations < 5) {
        const choice = response.choices[0];
        if (!choice?.message.tool_calls || choice.message.tool_calls.length === 0)
          break;

        chatMessages.push(choice.message);

        for (const toolCall of choice.message.tool_calls) {
          try {
            const args = JSON.parse(toolCall.function.arguments || "{}");
            const result = await this.executeTool(
              auth,
              toolCall.function.name,
              args,
            );
            chatMessages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify(result),
            });
          } catch {
            chatMessages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify({ error: "Gagal menjalankan tool" }),
            });
          }
        }

        response = await groq.chat.completions.create({
          model,
          messages: chatMessages,
          tools: TOOLS,
          tool_choice: "auto",
          max_tokens: 4096,
        });

        iterations++;
      }

      const text = response.choices[0]?.message.content;
      return { response: text || "Maaf, tidak bisa memproses permintaan." };
    } catch (err) {
      this.logger.error(
        `[AI Assistant] ${(err as Error).message}`,
        (err as Error).stack,
      );
      const msg = err instanceof Error ? err.message : "Unknown error";

      // Fallback: kalau model error karena tool calling validation (Llama-3
      // family quirk), retry tanpa tools — minta model jawab seadanya saja.
      // Ini menjamin user tetap dapat respons walau data terbatas.
      if (msg.includes("tool_use_failed") || msg.includes("tool call validation")) {
        this.logger.warn(
          "Tool calling failed — retrying without tools for fallback response",
        );
        try {
          const groq = new Groq({ apiKey });
          const fallbackResponse = await groq.chat.completions.create({
            model,
            messages: [
              {
                role: "system",
                content:
                  "Kamu asisten AI. User nanya tentang data toko, tapi kamu sedang tidak bisa akses tool/database. Minta maaf, sarankan user buka halaman terkait (mis. /products buat cari produk, /racks buat lihat rak) atau coba lagi sebentar. Singkat, dalam Bahasa Indonesia.",
              },
              ...messages.map((m) => ({
                role: m.role as "user" | "assistant",
                content: m.content,
              })),
            ],
            max_tokens: 256,
            temperature: 0.3,
          });
          return {
            response:
              fallbackResponse.choices[0]?.message.content ||
              "Maaf, AI sedang bermasalah. Coba buka halaman /products atau /racks untuk cari produk manual.",
          };
        } catch {
          return {
            error:
              "AI sedang bermasalah saat memanggil tool. Coba lagi atau buka halaman /products / /racks untuk cari manual.",
          };
        }
      }

      if (msg.includes("API") || msg.includes("key") || msg.includes("auth")) {
        return {
          error:
            "GROQ_API_KEY tidak valid. Dapatkan gratis di console.groq.com",
        };
      }
      if (msg.includes("429") || msg.includes("rate")) {
        return {
          error: "Rate limit tercapai. Coba lagi dalam beberapa detik.",
        };
      }
      if (msg.includes("decommissioned") || msg.includes("model")) {
        return {
          error:
            "Model AI sudah deprecated. Set GROQ_MODEL=openai/gpt-oss-120b di .env backend.",
        };
      }
      return { error: `Gagal memproses: ${msg}` };
    }
  }
}
