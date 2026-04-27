export type PlatformDashboardTopTenant = {
  companyId: string;
  companyName: string;
  revenue: number;
  txCount: number;
};

export type PlatformDashboardRecentPayment = {
  id: string;
  companyName: string;
  plan: string;
  amount: number;
  createdAt: string;
};

export type PlatformDashboardRecentCompany = {
  id: string;
  name: string;
  plan: string;
  userCount: number;
  createdAt: string;
};

export type PlatformDashboardExpiringCompany = {
  id: string;
  name: string;
  plan: string;
  expiresAt: string;
};

export type PlatformDashboardStatsResponse = {
  totalCompanies: number;
  totalUsers: number;
  totalBranches: number;
  totalProducts: number;
  planDistribution: {
    FREE: number;
    PRO: number;
    ENTERPRISE: number;
  };
  subscriptionRevenue: number;
  subscriptionCount: number;
  revenueGrowth: number;
  todayTransactions: number;
  monthTransactions: number;
  tenantTotalRevenue: number;
  activeShifts: number;
  newRegistrations: number;
  topTenants: PlatformDashboardTopTenant[];
  recentPayments: PlatformDashboardRecentPayment[];
  recentCompanies: PlatformDashboardRecentCompany[];
  expiringSoon: PlatformDashboardExpiringCompany[];
};
