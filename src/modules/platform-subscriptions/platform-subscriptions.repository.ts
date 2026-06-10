import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const PLATFORM_SUBSCRIPTION_SELECT = {
  id: true,
  companyId: true,
  plan: true,
  amount: true,
  durationMonths: true,
  billingType: true,
  status: true,
  planStartDate: true,
  planEndDate: true,
  notes: true,
  approvedBy: true,
  approvedAt: true,
  createdAt: true,
  company: { select: { name: true, slug: true } },
} satisfies Prisma.SubscriptionPaymentSelect;

export type RawPlatformSubscription = Prisma.SubscriptionPaymentGetPayload<{
  select: typeof PLATFORM_SUBSCRIPTION_SELECT;
}>;

const COMPANY_LIST_SELECT = {
  id: true,
  name: true,
  slug: true,
  email: true,
  phone: true,
  address: true,
  businessUnit: true,
  plan: true,
  planExpiresAt: true,
  isActive: true,
  createdAt: true,
  _count: { select: { users: true, branches: true, products: true } },
} satisfies Prisma.CompanySelect;

export type RawPlatformCompany = Prisma.CompanyGetPayload<{
  select: typeof COMPANY_LIST_SELECT;
}>;

@Injectable()
export class PlatformSubscriptionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    where: Prisma.SubscriptionPaymentWhereInput,
    skip: number,
    take: number,
  ): Promise<RawPlatformSubscription[]> {
    return this.prisma.subscriptionPayment.findMany({
      where,
      select: PLATFORM_SUBSCRIPTION_SELECT,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });
  }

  async count(
    where: Prisma.SubscriptionPaymentWhereInput,
  ): Promise<number> {
    return this.prisma.subscriptionPayment.count({ where });
  }

  async findById(id: string): Promise<RawPlatformSubscription | null> {
    return this.prisma.subscriptionPayment.findUnique({
      where: { id },
      select: PLATFORM_SUBSCRIPTION_SELECT,
    });
  }

  async findStatus(
    id: string,
  ): Promise<{
    id: string;
    status: string;
    plan: string;
    planEndDate: Date;
    companyId: string;
  } | null> {
    return this.prisma.subscriptionPayment.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        plan: true,
        planEndDate: true,
        companyId: true,
      },
    });
  }

  async findStatusOnly(
    id: string,
  ): Promise<{ id: string; status: string } | null> {
    return this.prisma.subscriptionPayment.findUnique({
      where: { id },
      select: { id: true, status: true },
    });
  }

  async findCompany(
    id: string,
  ): Promise<{ id: string; plan: string; planExpiresAt: Date | null } | null> {
    return this.prisma.company.findUnique({
      where: { id },
      select: { id: true, plan: true, planExpiresAt: true },
    });
  }

  async update(
    id: string,
    data: Prisma.SubscriptionPaymentUpdateInput,
  ): Promise<RawPlatformSubscription> {
    return this.prisma.subscriptionPayment.update({
      where: { id },
      data,
      select: PLATFORM_SUBSCRIPTION_SELECT,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.subscriptionPayment.delete({ where: { id } });
  }

  async countCompanies(): Promise<number> {
    return this.prisma.company.count();
  }

  async countActiveCompanies(): Promise<number> {
    return this.prisma.company.count({ where: { isActive: true } });
  }

  async groupByPlan() {
    return this.prisma.company.groupBy({
      by: ["plan"],
      _count: { _all: true },
    });
  }

  async countActiveSubscriptions(now: Date): Promise<number> {
    return this.prisma.subscriptionPayment.count({
      where: { status: "PAID", planEndDate: { gte: now } },
    });
  }

  async countPendingSubscriptions(): Promise<number> {
    return this.prisma.subscriptionPayment.count({
      where: { status: "PENDING" },
    });
  }

  async countExpiringSoon(now: Date, until: Date): Promise<number> {
    return this.prisma.company.count({
      where: {
        plan: { not: "FREE" },
        planExpiresAt: { gte: now, lte: until },
      },
    });
  }

  async findPaidSubscriptions(): Promise<
    { amount: number; durationMonths: number; planEndDate: Date }[]
  > {
    return this.prisma.subscriptionPayment.findMany({
      where: { status: "PAID" },
      select: {
        amount: true,
        durationMonths: true,
        planEndDate: true,
      },
    });
  }

  async findCompanies(
    where: Prisma.CompanyWhereInput,
  ): Promise<RawPlatformCompany[]> {
    return this.prisma.company.findMany({
      where,
      select: COMPANY_LIST_SELECT,
      orderBy: { createdAt: "desc" },
    });
  }
}
