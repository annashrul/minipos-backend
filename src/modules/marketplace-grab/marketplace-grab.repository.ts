import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export const GRAB_ACCOUNT_SELECT = {
  id: true,
  companyId: true,
  branchId: true,
  branch: { select: { id: true, name: true, code: true } },
  merchantId: true,
  merchantName: true,
  cookie: true,
  cookieUserAgent: true,
  isActive: true,
  lastSyncedAt: true,
  lastError: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.GrabAccountSelect;

export type RawGrabAccount = Prisma.GrabAccountGetPayload<{
  select: typeof GRAB_ACCOUNT_SELECT;
}>;

export const GRAB_DAILY_REPORT_SELECT = {
  id: true,
  accountId: true,
  account: { select: { id: true, merchantName: true, merchantId: true } },
  reportDate: true,
  orderCount: true,
  completedCount: true,
  cancelledCount: true,
  grossSales: true,
  netPayout: true,
  commission: true,
  refundAmount: true,
  rawPayload: true,
  fetchedAt: true,
} satisfies Prisma.GrabDailyReportSelect;

export type RawGrabDailyReport = Prisma.GrabDailyReportGetPayload<{
  select: typeof GRAB_DAILY_REPORT_SELECT;
}>;

export const GRAB_ORDER_SELECT = {
  id: true,
  accountId: true,
  account: { select: { id: true, merchantName: true } },
  grabOrderId: true,
  shortOrderId: true,
  customerName: true,
  customerPhone: true,
  subtotal: true,
  deliveryFee: true,
  discount: true,
  total: true,
  commission: true,
  netPayout: true,
  status: true,
  paymentMethod: true,
  cancelReason: true,
  items: true,
  itemCount: true,
  orderedAt: true,
  acceptedAt: true,
  readyAt: true,
  pickedUpAt: true,
  deliveredAt: true,
  cancelledAt: true,
  rawPayload: true,
  fetchedAt: true,
} satisfies Prisma.GrabOrderSelect;

export type RawGrabOrder = Prisma.GrabOrderGetPayload<{
  select: typeof GRAB_ORDER_SELECT;
}>;

@Injectable()
export class MarketplaceGrabRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── GrabAccount ──────────────────────────────────────────────────

  async upsertAccount(
    companyId: string,
    merchantId: string,
    create: Prisma.GrabAccountUncheckedCreateInput,
    update: Prisma.GrabAccountUncheckedUpdateInput,
  ) {
    return this.prisma.grabAccount.upsert({
      where: { companyId_merchantId: { companyId, merchantId } },
      create,
      update,
    });
  }

  async findManyAccounts(companyId: string) {
    return this.prisma.grabAccount.findMany({
      where: { companyId },
      include: { branch: { select: { id: true, name: true, code: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  async findAccountByIdAndCompany(accountId: string, companyId: string) {
    return this.prisma.grabAccount.findFirst({
      where: { id: accountId, companyId },
    });
  }

  async deleteAccount(accountId: string) {
    await this.prisma.grabAccount.delete({ where: { id: accountId } });
  }

  async findAccountById(accountId: string) {
    return this.prisma.grabAccount.findUnique({ where: { id: accountId } });
  }

  async findAllActiveAccounts() {
    return this.prisma.grabAccount.findMany({ where: { isActive: true } });
  }

  async updateAccountSync(accountId: string, data: Prisma.GrabAccountUpdateInput) {
    return this.prisma.grabAccount.update({
      where: { id: accountId },
      data,
    });
  }

  // ── GrabDailyReport ──────────────────────────────────────────────

  async upsertDailyReport(
    accountId: string,
    reportDate: Date,
    create: Prisma.GrabDailyReportUncheckedCreateInput,
    update: Prisma.GrabDailyReportUncheckedUpdateInput,
  ) {
    return this.prisma.grabDailyReport.upsert({
      where: { accountId_reportDate: { accountId, reportDate } },
      create,
      update,
    });
  }

  async findManyDailyReports(
    where: Prisma.GrabDailyReportWhereInput,
    take: number,
  ) {
    return this.prisma.grabDailyReport.findMany({
      where,
      include: {
        account: { select: { id: true, merchantName: true, merchantId: true } },
      },
      orderBy: [{ reportDate: "desc" }],
      take,
    });
  }

  // ── GrabOrder ────────────────────────────────────────────────────

  async upsertOrder(
    accountId: string,
    grabOrderId: string,
    create: Prisma.GrabOrderUncheckedCreateInput,
    update: Prisma.GrabOrderUncheckedUpdateInput,
  ) {
    return this.prisma.grabOrder.upsert({
      where: { accountId_grabOrderId: { accountId, grabOrderId } },
      create,
      update,
    });
  }

  async findManyOrders(
    where: Prisma.GrabOrderWhereInput,
    take: number,
    cursor?: string,
  ) {
    return this.prisma.grabOrder.findMany({
      where,
      include: {
        account: { select: { id: true, merchantName: true } },
      },
      orderBy: [{ orderedAt: "desc" }],
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }
}
