import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthUser } from "@/contracts";
import type { PaginatedResponse } from "@/common/types/response";
import { paginate } from "@/common/utils/pagination";
import type {
  CreateSubscriptionDto,
  CurrentSubscriptionResponse,
  ListSubscriptionsQueryDto,
  MarkSubscriptionPaidDto,
  SubscriptionResponse,
} from "./dto/subscriptions.dto";
import { PrismaService } from "@/modules/prisma/prisma.service";
import {
  SubscriptionsRepository,
  type RawSubscription,
} from "./subscriptions.repository";

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly repo: SubscriptionsRepository,
    private readonly prisma: PrismaService,
  ) {}

  async list(
    companyId: string,
    query: ListSubscriptionsQueryDto,
  ): Promise<PaginatedResponse<SubscriptionResponse>> {
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
      this.repo.findMany(where, (page - 1) * perPage, perPage),
      this.repo.count(where),
    ]);

    return paginate(rows.map(toSubscriptionResponse), total, page, perPage);
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<SubscriptionResponse> {
    const sub = await this.repo.findOne({ id, companyId });
    if (!sub) throw new NotFoundException("Subscription tidak ditemukan");
    return toSubscriptionResponse(sub);
  }

  async getCurrent(companyId: string): Promise<CurrentSubscriptionResponse> {
    const company = await this.repo.findCompanyPlan(companyId);
    if (!company) throw new NotFoundException("Company tidak ditemukan");

    const now = new Date();
    const subscription = await this.repo.findCurrentPaid(companyId, now);

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

    const created = await this.repo.create({
      companyId,
      plan: dto.plan,
      amount: dto.amount,
      durationMonths: dto.durationMonths,
      billingType: dto.billingType ?? "MONTHLY",
      status: "PENDING",
      planStartDate: start,
      planEndDate: end,
      notes: dto.notes ?? null,
    });

    return toSubscriptionResponse(created);
  }

  async markPaid(
    companyId: string,
    user: AuthUser,
    id: string,
    dto: MarkSubscriptionPaidDto,
  ): Promise<SubscriptionResponse> {
    const existing = await this.repo.findStatus(id, companyId);
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
        select: {
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
        },
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
    const existing = await this.repo.findStatusOnly(id, companyId);
    if (!existing) throw new NotFoundException("Subscription tidak ditemukan");
    if (existing.status !== "PENDING") {
      throw new BadRequestException(
        `Hanya status PENDING yang bisa di-cancel (saat ini ${existing.status})`,
      );
    }

    const updated = await this.repo.update(id, { status: "CANCELLED" });

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

    const existing = await this.repo.findStatusOnly(id, companyId);
    if (!existing) throw new NotFoundException("Subscription tidak ditemukan");
    if (existing.status === "PAID") {
      throw new BadRequestException(
        "Subscription dengan status PAID tidak bisa dihapus",
      );
    }

    await this.repo.delete(id);
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
