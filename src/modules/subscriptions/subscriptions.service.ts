import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  AuthUser,
  CreateSubscriptionDto,
  CurrentSubscriptionResponse,
  ListSubscriptionsQueryDto,
  MarkSubscriptionPaidDto,
  SubscriptionListResponse,
  SubscriptionResponse,
} from "@/contracts";
import { PrismaService } from "../prisma/prisma.service";

const SUBSCRIPTION_SELECT = {
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

type RawSubscription = Prisma.SubscriptionPaymentGetPayload<{
  select: typeof SUBSCRIPTION_SELECT;
}>;

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    companyId: string,
    query: ListSubscriptionsQueryDto,
  ): Promise<SubscriptionListResponse> {
    const { status, plan, from, to, page, perPage } = query;
    const where: Prisma.SubscriptionPaymentWhereInput = { companyId };
    if (status) where.status = status;
    if (plan) where.plan = plan;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const [rows, total] = await Promise.all([
      this.prisma.subscriptionPayment.findMany({
        where,
        select: SUBSCRIPTION_SELECT,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.subscriptionPayment.count({ where }),
    ]);

    return {
      subscriptions: rows.map(toSubscriptionResponse),
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<SubscriptionResponse> {
    const sub = await this.prisma.subscriptionPayment.findFirst({
      where: { id, companyId },
      select: SUBSCRIPTION_SELECT,
    });
    if (!sub) throw new NotFoundException("Subscription tidak ditemukan");
    return toSubscriptionResponse(sub);
  }

  async getCurrent(companyId: string): Promise<CurrentSubscriptionResponse> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { plan: true, planExpiresAt: true },
    });
    if (!company) throw new NotFoundException("Company tidak ditemukan");

    const now = new Date();
    const subscription = await this.prisma.subscriptionPayment.findFirst({
      where: {
        companyId,
        status: "PAID",
        planEndDate: { gte: now },
      },
      select: SUBSCRIPTION_SELECT,
      orderBy: { planEndDate: "desc" },
    });

    const isActive =
      company.plan !== "FREE" &&
      (!company.planExpiresAt || company.planExpiresAt >= now);

    return {
      plan: company.plan,
      planExpiresAt: company.planExpiresAt
        ? company.planExpiresAt.toISOString()
        : null,
      isActive,
      subscription: subscription ? toSubscriptionResponse(subscription) : null,
    };
  }

  async create(
    companyId: string,
    dto: CreateSubscriptionDto,
  ): Promise<SubscriptionResponse> {
    const start = new Date(dto.planStartDate);
    const end = new Date(dto.planEndDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException("Tanggal tidak valid");
    }
    if (end <= start) {
      throw new BadRequestException(
        "planEndDate harus setelah planStartDate",
      );
    }

    const created = await this.prisma.subscriptionPayment.create({
      data: {
        companyId,
        plan: dto.plan,
        amount: dto.amount,
        durationMonths: dto.durationMonths,
        billingType: dto.billingType ?? "MONTHLY",
        status: "PENDING",
        planStartDate: start,
        planEndDate: end,
        notes: dto.notes ?? null,
      },
      select: SUBSCRIPTION_SELECT,
    });

    return toSubscriptionResponse(created);
  }

  async markPaid(
    companyId: string,
    user: AuthUser,
    id: string,
    dto: MarkSubscriptionPaidDto,
  ): Promise<SubscriptionResponse> {
    const existing = await this.prisma.subscriptionPayment.findFirst({
      where: { id, companyId },
      select: { id: true, status: true, plan: true, planEndDate: true },
    });
    if (!existing) throw new NotFoundException("Subscription tidak ditemukan");
    if (existing.status !== "PENDING") {
      throw new BadRequestException(
        `Status saat ini ${existing.status}, tidak bisa di-mark paid`,
      );
    }

    const approvedAt = dto.paidAt ? new Date(dto.paidAt) : new Date();

    const data: Prisma.SubscriptionPaymentUpdateInput = {
      status: "PAID",
      approvedAt,
      approvedBy: user.id,
    };
    if (dto.notes !== undefined) data.notes = dto.notes;

    const updated = await this.prisma.$transaction(async (tx) => {
      const sub = await tx.subscriptionPayment.update({
        where: { id },
        data,
        select: SUBSCRIPTION_SELECT,
      });

      await tx.company.update({
        where: { id: companyId },
        data: {
          plan: existing.plan,
          planExpiresAt: existing.planEndDate,
        },
      });

      return sub;
    });

    return toSubscriptionResponse(updated);
  }

  async cancel(
    companyId: string,
    id: string,
  ): Promise<SubscriptionResponse> {
    const existing = await this.prisma.subscriptionPayment.findFirst({
      where: { id, companyId },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException("Subscription tidak ditemukan");
    if (existing.status !== "PENDING") {
      throw new BadRequestException(
        `Hanya status PENDING yang bisa di-cancel (saat ini ${existing.status})`,
      );
    }

    const updated = await this.prisma.subscriptionPayment.update({
      where: { id },
      data: { status: "CANCELLED" },
      select: SUBSCRIPTION_SELECT,
    });

    return toSubscriptionResponse(updated);
  }

  async delete(
    companyId: string,
    user: AuthUser,
    id: string,
  ): Promise<{ success: true }> {
    if (user.role !== "SUPER_ADMIN") {
      throw new ForbiddenException("Hanya super-admin yang bisa menghapus");
    }

    const existing = await this.prisma.subscriptionPayment.findFirst({
      where: { id, companyId },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException("Subscription tidak ditemukan");
    if (existing.status === "PAID") {
      throw new BadRequestException(
        "Subscription dengan status PAID tidak bisa dihapus",
      );
    }

    await this.prisma.subscriptionPayment.delete({ where: { id } });
    return { success: true };
  }
}

function toSubscriptionResponse(s: RawSubscription): SubscriptionResponse {
  return {
    id: s.id,
    companyId: s.companyId,
    plan: s.plan,
    amount: s.amount,
    durationMonths: s.durationMonths,
    billingType: s.billingType,
    status: s.status,
    planStartDate: s.planStartDate.toISOString(),
    planEndDate: s.planEndDate.toISOString(),
    notes: s.notes,
    approvedBy: s.approvedBy,
    approvedAt: s.approvedAt ? s.approvedAt.toISOString() : null,
    createdAt: s.createdAt.toISOString(),
  };
}
