import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const SUBSCRIPTION_SELECT = {
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
} satisfies Prisma.SubscriptionPaymentSelect;

export type RawSubscription = Prisma.SubscriptionPaymentGetPayload<{
  select: typeof SUBSCRIPTION_SELECT;
}>;

@Injectable()
export class SubscriptionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    where: Prisma.SubscriptionPaymentWhereInput,
    skip: number,
    take: number,
  ): Promise<RawSubscription[]> {
    return this.prisma.subscriptionPayment.findMany({
      where,
      select: SUBSCRIPTION_SELECT,
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

  async findOne(
    where: Prisma.SubscriptionPaymentWhereInput,
  ): Promise<RawSubscription | null> {
    return this.prisma.subscriptionPayment.findFirst({
      where,
      select: SUBSCRIPTION_SELECT,
    });
  }

  async findCurrentPaid(
    companyId: string,
    now: Date,
  ): Promise<RawSubscription | null> {
    return this.prisma.subscriptionPayment.findFirst({
      where: {
        companyId,
        status: "PAID",
        planEndDate: { gte: now },
      },
      select: SUBSCRIPTION_SELECT,
      orderBy: { planEndDate: "desc" },
    });
  }

  async findCompanyPlan(
    companyId: string,
  ): Promise<{ plan: string; planExpiresAt: Date | null } | null> {
    return this.prisma.company.findUnique({
      where: { id: companyId },
      select: { plan: true, planExpiresAt: true },
    });
  }

  async findStatus(
    id: string,
    companyId: string,
  ): Promise<{
    id: string;
    status: string;
    plan: string;
    planEndDate: Date;
  } | null> {
    return this.prisma.subscriptionPayment.findFirst({
      where: { id, companyId },
      select: { id: true, status: true, plan: true, planEndDate: true },
    });
  }

  async findStatusOnly(
    id: string,
    companyId: string,
  ): Promise<{ id: string; status: string } | null> {
    return this.prisma.subscriptionPayment.findFirst({
      where: { id, companyId },
      select: { id: true, status: true },
    });
  }

  async create(
    data: Prisma.SubscriptionPaymentUncheckedCreateInput,
  ): Promise<RawSubscription> {
    return this.prisma.subscriptionPayment.create({
      data,
      select: SUBSCRIPTION_SELECT,
    });
  }

  async update(
    id: string,
    data: Prisma.SubscriptionPaymentUpdateInput,
  ): Promise<RawSubscription> {
    return this.prisma.subscriptionPayment.update({
      where: { id },
      data,
      select: SUBSCRIPTION_SELECT,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.subscriptionPayment.delete({ where: { id } });
  }
}
