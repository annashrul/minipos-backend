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
  UpdatePlatformCompanyDto,
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

  // Update info tenant (nama, mode bisnis, telp, alamat) & status aktif.
  // Saat isActive di-toggle, status semua user tenant ikut disinkronkan supaya
  // login terblokir/terbuka.
  async updateCompany(
    id: string,
    dto: UpdatePlatformCompanyDto,
  ): Promise<{ success: true }> {
    const company = await this.prisma.company.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!company) throw new NotFoundException("Tenant tidak ditemukan");

    const data: Prisma.CompanyUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.businessUnit !== undefined) data.businessUnit = dto.businessUnit;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.address !== undefined) data.address = dto.address;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    await this.prisma.$transaction(async (tx) => {
      await tx.company.update({ where: { id }, data });
      if (dto.isActive !== undefined) {
        await tx.user.updateMany({
          where: { companyId: id },
          data: { isActive: dto.isActive },
        });
      }
    });
    return { success: true };
  }

  // HARD DELETE tenant — hapus company + SELURUH datanya secara permanen.
  // Rencana hapus dibangun runtime dari graf FK (information_schema) supaya
  // otomatis mengikuti perubahan skema. FK enforcement dimatikan via
  // `session_replication_role=replica` dalam transaksi, jadi hapus aman tanpa
  // mempersoalkan urutan FK; tiap tabel difilter ke company (langsung via
  // companyId, atau via subquery ke parent yang scoped).
  async hardDeleteCompany(id: string): Promise<{ success: true }> {
    const company = await this.prisma.company.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!company) throw new NotFoundException("Tenant tidak ditemukan");

    const baseRows = await this.prisma.$queryRawUnsafe<{ t: string }[]>(
      `SELECT table_name AS t FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    const baseTables = new Set(baseRows.map((r) => r.t));
    const directRows = await this.prisma.$queryRawUnsafe<{ t: string }[]>(
      `SELECT table_name AS t FROM information_schema.columns
       WHERE column_name = 'companyId' AND table_schema = 'public'`,
    );
    const direct = new Set(
      directRows.map((r) => r.t).filter((t) => baseTables.has(t)),
    );
    const fkRows = await this.prisma.$queryRawUnsafe<
      { child: string; fkcol: string; parent: string }[]
    >(
      `SELECT tc.table_name AS child, kcu.column_name AS fkcol, ccu.table_name AS parent
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`,
    );
    const edges = new Map<string, { fkcol: string; parent: string }[]>();
    for (const f of fkRows) {
      if (f.child === f.parent) continue;
      if (!baseTables.has(f.child) || !baseTables.has(f.parent)) continue;
      const arr = edges.get(f.child) ?? [];
      arr.push({ fkcol: f.fkcol, parent: f.parent });
      edges.set(f.child, arr);
    }

    // scoped = direct + tabel yang transitif terhubung ke company.
    const scoped = new Set(direct);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [child, es] of edges) {
        if (scoped.has(child)) continue;
        if (es.some((e) => scoped.has(e.parent))) {
          scoped.add(child);
          changed = true;
        }
      }
    }

    const buildWhere = (t: string, seen: Set<string>): string | null => {
      if (direct.has(t)) return `"companyId" = $1`;
      for (const e of edges.get(t) ?? []) {
        if (!scoped.has(e.parent) || seen.has(e.parent)) continue;
        const pw = buildWhere(e.parent, new Set([...seen, t]));
        if (pw) {
          return `"${e.fkcol}" IN (SELECT "id" FROM "${e.parent}" WHERE ${pw})`;
        }
      }
      return null;
    };

    // Urutan: anak sebelum induk (post-order pada graf parent).
    const order: string[] = [];
    const visited = new Set<string>();
    const visit = (t: string) => {
      if (visited.has(t)) return;
      visited.add(t);
      for (const [c, es] of edges) {
        if (scoped.has(c) && es.some((e) => e.parent === t)) visit(c);
      }
      order.push(t);
    };
    for (const t of scoped) visit(t);

    await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          `SET LOCAL session_replication_role = 'replica'`,
        );
        for (const t of order) {
          const w = buildWhere(t, new Set());
          if (!w) continue;
          await tx.$executeRawUnsafe(`DELETE FROM "${t}" WHERE ${w}`, id);
        }
        await tx.$executeRawUnsafe(
          `DELETE FROM "companies" WHERE "id" = $1`,
          id,
        );
      },
      { timeout: 120000 },
    );
    return { success: true };
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
    phone: c.phone,
    address: c.address,
    businessUnit: c.businessUnit,
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
