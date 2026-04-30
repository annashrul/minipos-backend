import { Injectable } from "@nestjs/common";
import type {
  CustomerFavoriteResponse,
  LoyaltySummaryResponse,
  PromoEffectivenessResponse,
  RepeatCustomerResponse,
  ShoppingFrequencyCustomerResponse,
  SupplierDebtResponse,
  SupplierRankingResponse,
} from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";

@Injectable()
export class RelationshipAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSupplierRanking(
    companyId: string,
    _branchId?: string,
  ): Promise<SupplierRankingResponse[]> {
    return this.prisma.$queryRawUnsafe<SupplierRankingResponse[]>(
      `
      SELECT s.name,
             COUNT(DISTINCT p.id)::int AS "productCount",
             COALESCE(SUM(po."totalAmount"), 0)::float AS "totalPOValue",
             COUNT(DISTINCT po.id)::int AS "poCount"
      FROM suppliers s
      LEFT JOIN products p ON p."supplierId" = s.id AND p."isActive" = true
      LEFT JOIN purchase_orders po ON po."supplierId" = s.id
      WHERE s."isActive" = true AND s."companyId" = $1
      GROUP BY s.id, s.name
      ORDER BY "totalPOValue" DESC
      `,
      companyId,
    );
  }

  async getSupplierDebt(
    companyId: string,
    _branchId?: string,
  ): Promise<SupplierDebtResponse[]> {
    return this.prisma.$queryRawUnsafe<SupplierDebtResponse[]>(
      `
      SELECT
        s.name as "supplierName",
        COALESCE((
          SELECT SUM(po."totalAmount")
          FROM purchase_orders po
          WHERE po."supplierId" = s.id
            AND po.status = 'RECEIVED'
        ), 0)::float as "totalPO",
        COALESCE((
          SELECT SUM(sp.amount)
          FROM supplier_payments sp
          WHERE sp."supplierId" = s.id
        ), 0)::float as "totalPaid",
        (
          COALESCE((
            SELECT SUM(po."totalAmount")
            FROM purchase_orders po
            WHERE po."supplierId" = s.id
              AND po.status = 'RECEIVED'
          ), 0) -
          COALESCE((
            SELECT SUM(sp.amount)
            FROM supplier_payments sp
            WHERE sp."supplierId" = s.id
          ), 0)
        )::float as debt
      FROM suppliers s
      WHERE s."isActive" = true AND s."companyId" = $1
      ORDER BY debt DESC
      `,
      companyId,
    );
  }

  async getPromoEffectiveness(
    companyId: string,
    _branchId?: string,
  ): Promise<PromoEffectivenessResponse[]> {
    const [promotions, txAgg] = await Promise.all([
      this.prisma.promotion.findMany({
        where: { companyId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      this.prisma.$queryRaw<
        { promoApplied: string; usageCount: number; totalDiscount: number }[]
      >`
          SELECT "promoApplied",
                 COUNT(*)::int AS "usageCount",
                 COALESCE(SUM("discountAmount"), 0)::float AS "totalDiscount"
          FROM transactions
          WHERE status = 'COMPLETED' AND "promoApplied" IS NOT NULL
          GROUP BY "promoApplied"
      `,
    ]);

    const txMap = new Map(txAgg.map((r) => [r.promoApplied, r]));

    return promotions
      .map((promo) => {
        const key = promo.voucherCode ?? promo.name;
        const agg = txMap.get(key) ?? { usageCount: 0, totalDiscount: 0 };
        return {
          promoName: promo.name,
          type: promo.type,
          usageCount: Math.max(agg.usageCount, promo.usageCount),
          totalDiscount: agg.totalDiscount,
          isActive: promo.isActive && new Date(promo.endDate) >= new Date(),
        };
      })
      .sort((a, b) => b.usageCount - a.usageCount);
  }

  async getRepeatCustomers(
    companyId: string,
    _branchId?: string,
  ): Promise<RepeatCustomerResponse[]> {
    const customers = await this.prisma.customer.findMany({
      where: { companyId },
      include: {
        _count: { select: { transactions: true } },
      },
      orderBy: { totalSpending: "desc" },
      take: 20,
    });

    return customers.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      email: c.email,
      memberLevel: c.memberLevel,
      totalSpending: c.totalSpending,
      points: c.points,
      transactionCount: c._count.transactions,
      isRepeat: c._count.transactions > 1,
    }));
  }

  async getCustomerFavorites(
    customerId: string,
    _branchId?: string,
  ): Promise<CustomerFavoriteResponse[]> {
    const items = await this.prisma.transactionItem.groupBy({
      by: ["productId", "productName"],
      where: { transaction: { customerId } },
      _sum: { quantity: true, subtotal: true },
      _count: true,
      orderBy: { _sum: { quantity: "desc" } },
      take: 10,
    });

    return items.map((i) => ({
      productName: i.productName,
      productId: i.productId,
      totalQty: i._sum.quantity || 0,
      totalSpent: i._sum.subtotal || 0,
      purchaseCount: i._count,
    }));
  }

  async getShoppingFrequency(
    companyId: string,
    _branchId?: string,
  ): Promise<ShoppingFrequencyCustomerResponse[]> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const customers = await this.prisma.customer.findMany({
      where: {
        companyId,
        transactions: { some: { createdAt: { gte: thirtyDaysAgo } } },
      },
      include: {
        transactions: {
          where: { createdAt: { gte: thirtyDaysAgo }, status: "COMPLETED" },
          select: { createdAt: true, grandTotal: true },
          orderBy: { createdAt: "desc" },
        },
      },
      take: 20,
    });

    return customers
      .map((c) => {
        const txCount = c.transactions.length;
        const totalSpent = c.transactions.reduce(
          (sum, tx) => sum + tx.grandTotal,
          0,
        );
        const lastVisit = c.transactions[0]?.createdAt ?? null;
        const avgSpending = txCount > 0 ? totalSpent / txCount : 0;

        return {
          id: c.id,
          name: c.name,
          phone: c.phone,
          memberLevel: c.memberLevel,
          visitCount: txCount,
          totalSpent,
          avgSpending,
          lastVisit: lastVisit ? lastVisit.toISOString() : null,
        };
      })
      .sort((a, b) => b.visitCount - a.visitCount);
  }

  async getLoyaltySummary(
    companyId: string,
    _branchId?: string,
  ): Promise<LoyaltySummaryResponse[]> {
    const levels = await this.prisma.customer.groupBy({
      by: ["memberLevel"],
      where: { companyId },
      _count: true,
      _sum: { totalSpending: true, points: true },
    });

    return levels.map((l) => ({
      level: l.memberLevel,
      count: l._count,
      totalSpending: l._sum.totalSpending || 0,
      totalPoints: l._sum.points || 0,
    }));
  }
}
