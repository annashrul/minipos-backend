import { Injectable, Logger } from "@nestjs/common";
import { CashierService } from "@/modules/cashier/cashier.service";
import { PurchasesService } from "@/modules/purchases/purchases.service";
import { AiAssistantRepository } from "./ai-assistant.repository";

type AuthContext = {
  userId: string;
  userName: string;
  role: string;
  companyId: string | null;
};

@Injectable()
export class AiAssistantToolsService {
  private readonly logger = new Logger(AiAssistantToolsService.name);

  constructor(
    private readonly repo: AiAssistantRepository,
    private readonly cashier: CashierService,
    private readonly purchases: PurchasesService,
  ) {}

  async executeGetTopProducts(input: {
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

    const items = await this.repo.groupTopProducts(where, limit);

    return items.map((i, idx) => ({
      rank: idx + 1,
      name: i.productName,
      code: i.productCode,
      totalQty: i._sum.quantity || 0,
      totalRevenue: i._sum.subtotal || 0,
    }));
  }

  async executeGetSlowProducts(input: {
    days?: number;
    limit?: number;
  }) {
    const days = input.days || 30;
    const limit = input.limit || 10;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const soldProducts = await this.repo.groupSoldProductIds(since);
    const soldIds = soldProducts.map((p) => p.productId);

    const slow = await this.repo.findSlowProducts(soldIds, limit);

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

  async executeGetSalesSummary(input: {
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
      this.repo.aggregateSales(where),
      this.repo.countTransactions(where),
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

  async executeGetLowStock(input: { limit?: number }) {
    const limit = input.limit || 20;

    const products = await this.repo.findLowStockRaw(limit);

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

  async executeGetCashierPerformance(
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

  async executeCreatePurchaseOrder(
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
    const products = await this.repo.findProductsByIds(productIds, auth.companyId);
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

  async executeGetRestockRecommendation(input: { days?: number }) {
    const days = input.days || 30;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const [salesData, products] = await Promise.all([
      this.repo.groupSalesData(since),
      this.repo.findActiveProducts(),
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

  async executeSearchProducts(
    auth: AuthContext,
    input: { query: string },
  ) {
    const q = input.query || "";
    const products = await this.repo.searchProducts(auth.companyId, q);

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
  async executeFindProductLocation(
    auth: AuthContext,
    input: { query: string },
  ) {
    const q = input.query || "";
    const products = await this.repo.findProductLocations(auth.companyId, q);

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
  async executeLookupRackContents(
    auth: AuthContext,
    input: { rackQuery: string },
  ) {
    const q = input.rackQuery || "";
    const racks = await this.repo.findRackContents(auth.companyId, q);

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
  async executeFindLowStockWithLocation(
    auth: AuthContext,
    input: { limit?: number },
  ) {
    const limit = input.limit || 20;
    const lowStock = await this.repo.findLowStockWithLocation(auth.companyId, limit);

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

  async executeGetSuppliers() {
    return this.repo.findActiveSuppliers();
  }

  async executeGetCategorySales(input: { days?: number }) {
    const days = input.days || 30;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const rows = await this.repo.getCategorySalesRaw(since);

    return rows.map((r) => ({
      category: r.name,
      totalQuantity: Number(r.qty),
      totalRevenue: Number(r.revenue),
      totalItems: Number(r.items),
    }));
  }
}
