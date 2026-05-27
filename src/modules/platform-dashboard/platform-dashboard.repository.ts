import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const RECENT_COMPANY_SELECT = {
  id: true,
  name: true,
  plan: true,
  createdAt: true,
  _count: { select: { users: true } },
} satisfies Prisma.CompanySelect;

export type RawRecentCompany = Prisma.CompanyGetPayload<{
  select: typeof RECENT_COMPANY_SELECT;
}>;

export const RECENT_PAYMENT_SELECT = {
  id: true,
  plan: true,
  amount: true,
  createdAt: true,
  company: { select: { name: true } },
} satisfies Prisma.SubscriptionPaymentSelect;

export type RawRecentPayment = Prisma.SubscriptionPaymentGetPayload<{
  select: typeof RECENT_PAYMENT_SELECT;
}>;

export const EXPIRING_COMPANY_SELECT = {
  id: true,
  name: true,
  plan: true,
  planExpiresAt: true,
} satisfies Prisma.CompanySelect;

export type RawExpiringCompany = Prisma.CompanyGetPayload<{
  select: typeof EXPIRING_COMPANY_SELECT;
}>;

export type RawTopTenant = {
  companyId: string;
  companyName: string;
  revenue: number;
  txCount: number;
};

@Injectable()
export class PlatformDashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  async countCompanies(): Promise<number> {
    return this.prisma.company.count();
  }

  async countNonPlatformUsers(): Promise<number> {
    return this.prisma.user.count({
      where: { role: { not: "PLATFORM_OWNER" } },
    });
  }

  async countBranches(): Promise<number> {
    return this.prisma.branch.count();
  }

  async countProducts(): Promise<number> {
    return this.prisma.product.count();
  }

  async groupByPlan() {
    return this.prisma.company.groupBy({
      by: ["plan"],
      _count: { _all: true },
    });
  }

  async findRecentCompanies(take: number): Promise<RawRecentCompany[]> {
    return this.prisma.company.findMany({
      select: RECENT_COMPANY_SELECT,
      orderBy: { createdAt: "desc" },
      take,
    });
  }

  async aggregateSubscriptionRevenue(gte: Date) {
    return this.prisma.subscriptionPayment.aggregate({
      where: { status: "PAID", createdAt: { gte } },
      _sum: { amount: true },
      _count: { _all: true },
    });
  }

  async aggregatePrevMonthRevenue(gte: Date, lt: Date) {
    return this.prisma.subscriptionPayment.aggregate({
      where: { status: "PAID", createdAt: { gte, lt } },
      _sum: { amount: true },
    });
  }

  async countCompletedTransactions(gte: Date): Promise<number> {
    return this.prisma.transaction.count({
      where: { status: "COMPLETED", createdAt: { gte } },
    });
  }

  async aggregateTenantRevenue(gte: Date) {
    return this.prisma.transaction.aggregate({
      where: { status: "COMPLETED", createdAt: { gte } },
      _sum: { grandTotal: true },
    });
  }

  async countActiveShifts(): Promise<number> {
    return this.prisma.cashierShift.count({ where: { isOpen: true } });
  }

  async countNewRegistrations(since: Date): Promise<number> {
    return this.prisma.company.count({
      where: { createdAt: { gte: since } },
    });
  }

  async findTopTenants(
    monthStart: Date,
    limit: number,
  ): Promise<RawTopTenant[]> {
    return this.prisma.$queryRawUnsafe<RawTopTenant[]>(
      `
      SELECT c.id AS "companyId", c.name AS "companyName",
        COALESCE(SUM(t."grandTotal"), 0)::float AS revenue,
        COUNT(t.id)::int AS "txCount"
      FROM companies c
      LEFT JOIN branches b ON b."companyId" = c.id
      LEFT JOIN transactions t ON t."branchId" = b.id AND t.status = 'COMPLETED' AND t."createdAt" >= $1
      GROUP BY c.id, c.name
      HAVING COUNT(t.id) > 0
      ORDER BY revenue DESC
      LIMIT $2
    `,
      monthStart,
      limit,
    );
  }

  async findRecentPayments(take: number): Promise<RawRecentPayment[]> {
    return this.prisma.subscriptionPayment.findMany({
      where: { status: "PAID" },
      select: RECENT_PAYMENT_SELECT,
      orderBy: { createdAt: "desc" },
      take,
    });
  }

  async findExpiringSoon(
    now: Date,
    withinDate: Date,
  ): Promise<RawExpiringCompany[]> {
    return this.prisma.company.findMany({
      where: {
        plan: { not: "FREE" },
        planExpiresAt: { gte: now, lte: withinDate },
      },
      select: EXPIRING_COMPANY_SELECT,
      orderBy: { planExpiresAt: "asc" },
    });
  }
}
