import { Injectable } from "@nestjs/common";
import type { PlatformDashboardStatsResponse } from "./dto/platform-dashboard.dto";
import { PlatformDashboardRepository } from "./platform-dashboard.repository";

@Injectable()
export class PlatformDashboardService {
  constructor(private readonly repo: PlatformDashboardRepository) {}

  async stats(): Promise<PlatformDashboardStatsResponse> {
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [
      totalCompanies,
      totalUsers,
      totalBranches,
      totalProducts,
      planCounts,
      recentCompanies,
      subscriptionPayments,
      prevMonthlyRevenue,
      todayTransactions,
      monthTransactions,
      tenantRevenue,
      activeShifts,
      newRegistrations,
      topTenants,
      recentPayments,
      expiringSoon,
    ] = await Promise.all([
      this.repo.countCompanies(),
      this.repo.countNonPlatformUsers(),
      this.repo.countBranches(),
      this.repo.countProducts(),
      this.repo.groupByPlan(),
      this.repo.findRecentCompanies(5),
      this.repo.aggregateSubscriptionRevenue(monthStart),
      this.repo.aggregatePrevMonthRevenue(prevMonthStart, monthStart),
      this.repo.countCompletedTransactions(todayStart),
      this.repo.countCompletedTransactions(monthStart),
      this.repo.aggregateTenantRevenue(monthStart),
      this.repo.countActiveShifts(),
      this.repo.countNewRegistrations(sevenDaysAgo),
      this.repo.findTopTenants(monthStart, 5),
      this.repo.findRecentPayments(5),
      this.repo.findExpiringSoon(now, sevenDaysLater),
    ]);

    const planMap: Record<string, number> = {};
    for (const p of planCounts) {
      planMap[p.plan] = p._count._all;
    }

    const subRevenue = subscriptionPayments?._sum?.amount || 0;
    const prevSubRevenue = prevMonthlyRevenue?._sum?.amount || 0;
    const revenueGrowth =
      prevSubRevenue > 0
        ? ((subRevenue - prevSubRevenue) / prevSubRevenue) * 100
        : 0;

    return {
      totalCompanies,
      totalUsers,
      totalBranches,
      totalProducts,
      planDistribution: {
        FREE: planMap["FREE"] || 0,
        PRO: planMap["PRO"] || 0,
        ENTERPRISE: planMap["ENTERPRISE"] || 0,
      },
      subscriptionRevenue: subRevenue,
      subscriptionCount: subscriptionPayments._count._all,
      revenueGrowth: Math.round(revenueGrowth * 10) / 10,
      todayTransactions,
      monthTransactions,
      tenantTotalRevenue: tenantRevenue?._sum?.grandTotal || 0,
      activeShifts,
      newRegistrations,
      topTenants: topTenants.map((t) => ({
        companyId: t.companyId,
        companyName: t.companyName,
        revenue: t.revenue,
        txCount: t.txCount,
      })),
      recentPayments: recentPayments.map((p) => ({
        id: p.id,
        companyName: p.company.name,
        plan: p.plan,
        amount: p.amount,
        createdAt: p.createdAt.toISOString(),
      })),
      recentCompanies: recentCompanies.map((c) => ({
        id: c.id,
        name: c.name,
        plan: c.plan,
        userCount: c._count.users,
        createdAt: c.createdAt.toISOString(),
      })),
      expiringSoon: expiringSoon
        .filter((c) => c.planExpiresAt !== null)
        .map((c) => ({
          id: c.id,
          name: c.name,
          plan: c.plan,
          expiresAt: c.planExpiresAt!.toISOString(),
        })),
    };
  }
}
