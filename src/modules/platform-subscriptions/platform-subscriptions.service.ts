import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AuthUser } from "@/contracts";
import type { PaginatedResponse } from "@/common/types/response";
import { paginate } from "@/common/utils/pagination";
import type {
  CreatePlatformSubscriptionDto,
  ListPlatformCompaniesQueryDto,
  ListPlatformSubscriptionsQueryDto,
  MarkPlatformSubscriptionPaidDto,
  PlatformCompanyResponse,
  PlatformSubscriptionResponse,
  PlatformSubscriptionStatsResponse,
} from "./dto/platform-subscriptions.dto";
import {
  PlatformSubscriptionsRepository,
  type RawPlatformCompany,
  type RawPlatformSubscription,
} from "./platform-subscriptions.repository";
import { PrismaService } from "@/modules/prisma/prisma.service";

@Injectable()
export class PlatformSubscriptionsService {
  constructor(
    private readonly repo: PlatformSubscriptionsRepository,
    private readonly prisma: PrismaService,
  ) {}

  async list(
    query: ListPlatformSubscriptionsQueryDto,
  ): Promise<PaginatedResponse<PlatformSubscriptionResponse>> {
    const { companyId, status, plan, from, to, page, perPage } = query;
    const where: Prisma.SubscriptionPaymentWhereInput = {};
    if (companyId) where.companyId = companyId;
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

    return paginate(rows.map(toPlatformSubscription), total, page, perPage);
  }

  async findById(id: string): Promise<PlatformSubscriptionResponse> {
    const sub = await this.repo.findById(id);
    if (!sub) throw new NotFoundException("Subscription tidak ditemukan");
    return toPlatformSubscription(sub);
  }

  async create(
    user: AuthUser,
    dto: CreatePlatformSubscriptionDto,
  ): Promise<PlatformSubscriptionResponse> {
    const company = await this.repo.findCompany(dto.companyId);
    if (!company) throw new NotFoundException("Company tidak ditemukan");

    const start = dto.planStartDate
      ? new Date(dto.planStartDate)
      : company.planExpiresAt && company.planExpiresAt > new Date()
        ? company.planExpiresAt
        : new Date();

    let end: Date;
    if (dto.planEndDate) {
      end = new Date(dto.planEndDate);
    } else {
      end = new Date(start);
      end.setMonth(end.getMonth() + dto.durationMonths);
    }

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException("Tanggal tidak valid");
    }
    if (end <= start) {
      throw new BadRequestException(
        "planEndDate harus setelah planStartDate",
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const sub = await tx.subscriptionPayment.create({
        data: {
          companyId: dto.companyId,
          plan: dto.plan,
          amount: dto.amount,
          durationMonths: dto.durationMonths,
          billingType: dto.billingType ?? "MONTHLY",
          status: dto.markPaid ? "PAID" : "PENDING",
          planStartDate: start,
          planEndDate: end,
          notes: dto.notes ?? null,
          approvedBy: dto.markPaid ? user.id : null,
          approvedAt: dto.markPaid ? new Date() : null,
        },
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
          company: { select: { name: true, slug: true } },
        },
      });

      if (dto.markPaid) {
        await tx.company.update({
          where: { id: dto.companyId },
          data: { plan: dto.plan, planExpiresAt: end },
        });
      }

      return sub;
    });

    return toPlatformSubscription(created);
  }

  async markPaid(
    user: AuthUser,
    id: string,
    dto: MarkPlatformSubscriptionPaidDto,
  ): Promise<PlatformSubscriptionResponse> {
    const existing = await this.repo.findStatus(id);
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
          company: { select: { name: true, slug: true } },
        },
      });
      await tx.company.update({
        where: { id: existing.companyId },
        data: { plan: existing.plan, planExpiresAt: existing.planEndDate },
      });
      return sub;
    });

    return toPlatformSubscription(updated);
  }

  async cancel(id: string): Promise<PlatformSubscriptionResponse> {
    const existing = await this.repo.findStatusOnly(id);
    if (!existing) throw new NotFoundException("Subscription tidak ditemukan");
    if (existing.status !== "PENDING") {
      throw new BadRequestException(
        `Hanya status PENDING yang bisa di-cancel (saat ini ${existing.status})`,
      );
    }

    const updated = await this.repo.update(id, { status: "CANCELLED" });
    return toPlatformSubscription(updated);
  }

  async delete(id: string): Promise<{ success: true }> {
    const existing = await this.repo.findStatusOnly(id);
    if (!existing) throw new NotFoundException("Subscription tidak ditemukan");
    if (existing.status === "PAID") {
      throw new BadRequestException(
        "Subscription dengan status PAID tidak bisa dihapus",
      );
    }

    await this.repo.delete(id);
    return { success: true };
  }

  async revokeCompanyPlan(
    user: AuthUser,
    companyId: string,
  ): Promise<{ success: true }> {
    const company = await this.repo.findCompany(companyId);
    if (!company) throw new NotFoundException("Company tidak ditemukan");

    await this.prisma.$transaction(async (tx) => {
      await tx.company.update({
        where: { id: companyId },
        data: { plan: "FREE", planExpiresAt: null },
      });
      const now = new Date();
      await tx.subscriptionPayment.create({
        data: {
          companyId,
          plan: company.plan || "PRO",
          amount: 0,
          durationMonths: 0,
          billingType: "MONTHLY",
          status: "CANCELLED",
          planStartDate: now,
          planEndDate: now,
          notes: "Plan revoked by platform owner",
          approvedBy: user.id,
          approvedAt: now,
        },
      });
    });

    return { success: true };
  }

  async stats(): Promise<PlatformSubscriptionStatsResponse> {
    const now = new Date();
    const in30Days = new Date();
    in30Days.setDate(in30Days.getDate() + 30);

    const [
      totalCompanies,
      activeCompanies,
      planCounts,
      activeSubscriptions,
      pendingSubscriptions,
      expiringSoon,
      paidSubs,
    ] = await Promise.all([
      this.repo.countCompanies(),
      this.repo.countActiveCompanies(),
      this.repo.groupByPlan(),
      this.repo.countActiveSubscriptions(now),
      this.repo.countPendingSubscriptions(),
      this.repo.countExpiringSoon(now, in30Days),
      this.repo.findPaidSubscriptions(),
    ]);

    const byPlan = { FREE: 0, PRO: 0, ENTERPRISE: 0 };
    for (const row of planCounts) {
      if (row.plan in byPlan) {
        byPlan[row.plan as keyof typeof byPlan] = row._count._all;
      }
    }

    let mrr = 0;
    let totalRevenue = 0;
    for (const s of paidSubs) {
      totalRevenue += s.amount;
      if (s.planEndDate >= now && s.durationMonths > 0) {
        mrr += s.amount / s.durationMonths;
      }
    }

    return {
      totalCompanies,
      activeCompanies,
      byPlan,
      activeSubscriptions,
      pendingSubscriptions,
      expiringSoon,
      mrr: Math.round(mrr),
      totalRevenue,
    };
  }

  async listCompanies(
    query: ListPlatformCompaniesQueryDto,
  ): Promise<PlatformCompanyResponse[]> {
    const where: Prisma.CompanyWhereInput = {};
    if (query.plan) where.plan = query.plan;
    if (query.isActive !== undefined) where.isActive = query.isActive;
    if (query.search) {
      const term = query.search;
      where.OR = [
        { name: { contains: term, mode: "insensitive" } },
        { slug: { contains: term, mode: "insensitive" } },
        { email: { contains: term, mode: "insensitive" } },
      ];
    }

    const companies = await this.repo.findCompanies(where);
    return companies.map(toCompanyResponse);
  }
}

function toPlatformSubscription(
  s: RawPlatformSubscription,
): PlatformSubscriptionResponse {
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
    companyName: s.company.name,
    companySlug: s.company.slug,
  };
}

function toCompanyResponse(c: RawPlatformCompany): PlatformCompanyResponse {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    email: c.email,
    plan: c.plan,
    planExpiresAt: c.planExpiresAt ? c.planExpiresAt.toISOString() : null,
    isActive: c.isActive,
    createdAt: c.createdAt.toISOString(),
    counts: {
      users: c._count.users,
      branches: c._count.branches,
      products: c._count.products,
    },
  };
}
