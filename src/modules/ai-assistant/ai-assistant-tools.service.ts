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

// Label metode pembayaran (enum PaymentMethod) ke Bahasa Indonesia ramah-baca.
function paymentLabel(m: string): string {
  const map: Record<string, string> = {
    CASH: "Tunai",
    TRANSFER: "Transfer Bank",
    QRIS: "QRIS",
    EWALLET: "E-Wallet",
    DEBIT: "Kartu Debit",
    CREDIT_CARD: "Kartu Kredit",
    TERMIN: "Termin/Tempo",
    SPLIT_BILL: "Split Bill",
  };
  return map[m] || m;
}

@Injectable()
export class AiAssistantToolsService {
  private readonly logger = new Logger(AiAssistantToolsService.name);

  constructor(
    private readonly repo: AiAssistantRepository,
    private readonly cashier: CashierService,
    private readonly purchases: PurchasesService,
  ) {}

  async executeGetTopProducts(
    auth: AuthContext,
    input: {
      limit?: number;
      days?: number;
      branchId?: string;
    },
  ) {
    const days = input.days || 30;
    const limit = input.limit || 10;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const txFilter: Record<string, unknown> = {
      status: "COMPLETED",
      createdAt: { gte: since },
    };
    if (auth.companyId) txFilter.user = { companyId: auth.companyId };
    if (input.branchId) txFilter.branchId = input.branchId;

    const where: Record<string, unknown> = { transaction: txFilter };
    const items = await this.repo.groupTopProducts(where, limit);

    return items.map((i, idx) => ({
      rank: idx + 1,
      name: i.productName,
      code: i.productCode,
      totalQty: i._sum.quantity || 0,
      totalRevenue: i._sum.subtotal || 0,
    }));
  }

  async executeGetSlowProducts(
    auth: AuthContext,
    input: {
      days?: number;
      limit?: number;
    },
  ) {
    const days = input.days || 30;
    const limit = input.limit || 10;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const soldProducts = await this.repo.groupSoldProductIds(
      auth.companyId,
      since,
    );
    const soldIds = soldProducts.map((p) => p.productId);

    const slow = await this.repo.findSlowProducts(
      auth.companyId,
      soldIds,
      limit,
    );

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

  async executeGetSalesSummary(
    auth: AuthContext,
    input: {
      period?: string;
      branchId?: string;
    },
  ) {
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
    if (auth.companyId) where.user = { companyId: auth.companyId };
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

  async executeGetLowStock(auth: AuthContext, input: { limit?: number }) {
    const limit = input.limit || 20;

    const products = await this.repo.findLowStockRaw(auth.companyId, limit);

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

  async executeGetRestockRecommendation(
    auth: AuthContext,
    input: { days?: number },
  ) {
    const days = input.days || 30;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const [salesData, products] = await Promise.all([
      this.repo.groupSalesData(auth.companyId, since),
      this.repo.findActiveProducts(auth.companyId),
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

  async executeGetSuppliers(auth: AuthContext) {
    return this.repo.findActiveSuppliers(auth.companyId);
  }

  async executeGetCategorySales(
    auth: AuthContext,
    input: { days?: number },
  ) {
    const days = input.days || 30;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const rows = await this.repo.getCategorySalesRaw(auth.companyId, since);

    return rows.map((r) => ({
      category: r.name,
      totalQuantity: Number(r.qty),
      totalRevenue: Number(r.revenue),
      totalItems: Number(r.items),
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Analytics tambahan: dashboard, metode pembayaran, meja, tren, laba
  // ─────────────────────────────────────────────────────────────────────────

  // Resolve "today"/"week"/"month"/"year" jadi rentang sekarang + periode
  // sebelumnya (untuk perbandingan). Catatan: boundary pakai jam server (UTC) —
  // konsisten dengan tool ringkasan penjualan lain.
  private resolvePeriod(period?: string): {
    start: Date;
    end: Date;
    prevStart: Date;
    prevEnd: Date;
    label: string;
  } {
    const now = new Date();
    let start: Date;
    let prevStart: Date;
    let prevEnd: Date;
    let label: string;

    if (period === "today") {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      prevEnd = start;
      prevStart = new Date(start);
      prevStart.setDate(start.getDate() - 1);
      label = "hari ini";
    } else if (period === "week") {
      start = new Date(now);
      start.setDate(now.getDate() - 7);
      prevEnd = start;
      prevStart = new Date(now);
      prevStart.setDate(now.getDate() - 14);
      label = "7 hari terakhir";
    } else if (period === "year") {
      start = new Date(now.getFullYear(), 0, 1);
      prevStart = new Date(now.getFullYear() - 1, 0, 1);
      prevEnd = start;
      label = "tahun ini";
    } else {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      prevEnd = start;
      label = "bulan ini";
    }
    return { start, end: now, prevStart, prevEnd, label };
  }

  // Ringkasan dashboard: omzet, transaksi, rata-rata, diskon/pajak, vs periode
  // sebelumnya, metode bayar teratas, produk teratas.
  async executeGetDashboardOverview(
    auth: AuthContext,
    input: { period?: string; branchId?: string },
  ) {
    const { start, end, prevStart, prevEnd, label } = this.resolvePeriod(
      input.period,
    );
    const [agg, prevAgg, payments, topProd] = await Promise.all([
      this.repo.aggregateSalesScoped(auth.companyId, start, end, input.branchId),
      this.repo.aggregateSalesScoped(
        auth.companyId,
        prevStart,
        prevEnd,
        input.branchId,
      ),
      this.repo.groupPaymentMethods(auth.companyId, start, end, input.branchId),
      this.repo.topProductScoped(
        auth.companyId,
        start,
        end,
        input.branchId,
        3,
      ),
    ]);

    const revenue = agg._sum.grandTotal || 0;
    const count = agg._count._all;
    const prevRevenue = prevAgg._sum.grandTotal || 0;
    const changePercent =
      prevRevenue > 0
        ? Math.round(((revenue - prevRevenue) / prevRevenue) * 1000) / 10
        : null;
    const topPay = payments[0];

    return {
      period: label,
      revenue,
      transactions: count,
      averageTicket: count > 0 ? Math.round(revenue / count) : 0,
      discount: agg._sum.discountAmount || 0,
      tax: agg._sum.taxAmount || 0,
      vsPreviousPeriod: {
        prevRevenue,
        changePercent,
        trend:
          changePercent == null ? "n/a" : changePercent >= 0 ? "naik" : "turun",
      },
      topPaymentMethod: topPay
        ? {
            method: paymentLabel(topPay.paymentMethod),
            amount: topPay._sum.grandTotal || 0,
            count: topPay._count._all,
          }
        : null,
      topProducts: topProd.map((p) => ({
        name: p.productName,
        qty: p._sum.quantity || 0,
        revenue: p._sum.subtotal || 0,
      })),
    };
  }

  // Breakdown metode pembayaran — menjawab "metode penjualan/bayar paling ramai".
  async executeGetPaymentBreakdown(
    auth: AuthContext,
    input: { period?: string; branchId?: string },
  ) {
    const { start, end, label } = this.resolvePeriod(input.period);
    const rows = await this.repo.groupPaymentMethods(
      auth.companyId,
      start,
      end,
      input.branchId,
    );
    const totalAmount = rows.reduce(
      (s, r) => s + (r._sum.grandTotal || 0),
      0,
    );
    const totalCount = rows.reduce((s, r) => s + r._count._all, 0);

    return {
      period: label,
      totalRevenue: totalAmount,
      totalTransactions: totalCount,
      busiestMethod: rows[0] ? paymentLabel(rows[0].paymentMethod) : null,
      methods: rows.map((r) => ({
        method: paymentLabel(r.paymentMethod),
        amount: r._sum.grandTotal || 0,
        count: r._count._all,
        percentByAmount:
          totalAmount > 0
            ? Math.round(((r._sum.grandTotal || 0) / totalAmount) * 1000) / 10
            : 0,
      })),
    };
  }

  // Status meja sekarang (restoran/cafe): jumlah per status + meja terisi.
  async executeGetTableStatus(
    auth: AuthContext,
    input: { branchId?: string },
  ) {
    const tables = await this.repo.tableStatusList(
      auth.companyId,
      input.branchId,
    );
    if (tables.length === 0) {
      return {
        found: false,
        message:
          "Belum ada data meja. Fitur meja hanya untuk bisnis restoran/cafe.",
      };
    }

    const counts: Record<string, number> = {};
    for (const t of tables) counts[t.status] = (counts[t.status] || 0) + 1;

    const occupiedTables = tables
      .filter((t) => t.tableSessions.length > 0 || t.status === "OCCUPIED")
      .map((t) => {
        const s = t.tableSessions[0];
        return {
          table: t.name || `Meja ${t.number}`,
          section: t.section,
          status: t.status,
          customer: s?.customerName || null,
          currentBill: s?.subtotal || 0,
          sessionStatus: s?.status || null,
          openedAt: s?.openedAt ? s.openedAt.toISOString() : null,
        };
      });

    return {
      found: true,
      totalTables: tables.length,
      statusCounts: counts,
      availableCount: counts["AVAILABLE"] || 0,
      occupiedCount: occupiedTables.length,
      occupiedTables,
    };
  }

  // Meja paling ramai (by omzet & jumlah transaksi) dalam periode.
  async executeGetBusiestTables(
    auth: AuthContext,
    input: { period?: string; limit?: number },
  ) {
    const { start, end, label } = this.resolvePeriod(input.period);
    const rows = await this.repo.busiestTablesRaw(
      auth.companyId,
      start,
      end,
      input.limit || 10,
    );
    if (rows.length === 0) {
      return {
        period: label,
        found: false,
        message: "Belum ada transaksi yang terkait meja pada periode ini.",
      };
    }
    return {
      period: label,
      found: true,
      tables: rows.map((r, i) => ({
        rank: i + 1,
        table: r.name || `Meja ${r.number}`,
        section: r.section,
        branch: r.branch,
        transactions: Number(r.txCount),
        revenue: r.revenue,
      })),
    };
  }

  // Tren penjualan harian N hari terakhir + hari paling ramai.
  async executeGetSalesTrend(
    auth: AuthContext,
    input: { days?: number; branchId?: string },
  ) {
    const days = input.days || 14;
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);

    const rows = await this.repo.salesTrendRaw(
      auth.companyId,
      start,
      end,
      input.branchId,
    );
    const trend = rows.map((r) => ({
      date: r.date,
      transactions: Number(r.txCount),
      revenue: r.revenue,
    }));
    const busiestDay = trend.reduce<(typeof trend)[number] | null>(
      (best, d) => (best == null || d.revenue > best.revenue ? d : best),
      null,
    );

    return { days, busiestDay, trend };
  }

  // Ringkasan laba kotor (estimasi) — omzet, modal (COGS), laba, margin.
  async executeGetProfitSummary(
    auth: AuthContext,
    input: { period?: string; branchId?: string },
  ) {
    const { start, end, label } = this.resolvePeriod(input.period);
    const [row] = await this.repo.profitSummaryRaw(
      auth.companyId,
      start,
      end,
      input.branchId,
    );
    const revenue = row?.revenue || 0;
    const cogs = row?.cogs || 0;
    const grossProfit = revenue - cogs;

    return {
      period: label,
      note: "Laba kotor ESTIMASI — modal (COGS) memakai harga beli produk saat ini, bukan harga beli historis saat transaksi.",
      revenue,
      cogs,
      grossProfit,
      marginPercent:
        revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : 0,
      transactions: Number(row?.txCount || 0),
    };
  }
}
