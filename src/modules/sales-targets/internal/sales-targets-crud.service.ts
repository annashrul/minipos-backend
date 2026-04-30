import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateSalesTargetDto,
  ListSalesTargetsQueryDto,
  SalesTargetListResponse,
  SalesTargetResponse,
  UpdateSalesTargetDto,
} from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";
import { AchievementCalculator } from "./achievement-calculator.service";
import {
  derivePeriod,
  getPeriodRange,
  SALES_TARGET_SELECT,
  tenantWhere,
  throwOnDup,
} from "./sales-targets.shared";

@Injectable()
export class SalesTargetsCrudService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calculator: AchievementCalculator,
  ) {}

  async list(
    companyId: string,
    query: ListSalesTargetsQueryDto,
  ): Promise<SalesTargetListResponse> {
    const {
      search,
      type,
      branchId,
      userId,
      status,
      period,
      from,
      to,
      page,
      perPage,
    } = query;

    const where: Prisma.SalesTargetWhereInput = { ...tenantWhere(companyId) };
    if (type) where.type = type;
    if (branchId) where.branchId = branchId;
    if (userId) where.userId = userId;
    if (period) where.period = period;
    if (search) {
      where.OR = [
        { user: { is: { name: { contains: search, mode: "insensitive" } } } },
      ];
    }
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }
    if (status === "ACTIVE") where.isActive = true;

    const [rows, total] = await Promise.all([
      this.prisma.salesTarget.findMany({
        where,
        select: SALES_TARGET_SELECT,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.salesTarget.count({ where }),
    ]);

    let mapped = await Promise.all(
      rows.map((r) => this.calculator.toResponse(r)),
    );

    if (status === "ACTIVE") mapped = mapped.filter((m) => m.status === "ACTIVE");
    if (status === "COMPLETED")
      mapped = mapped.filter((m) => m.status === "COMPLETED");
    if (status === "FAILED")
      mapped = mapped.filter((m) => m.status === "FAILED");

    return {
      salesTargets: mapped,
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<SalesTargetResponse> {
    const target = await this.prisma.salesTarget.findFirst({
      where: { id, ...tenantWhere(companyId) },
      select: SALES_TARGET_SELECT,
    });
    if (!target) throw new NotFoundException("Sales target not found");
    return this.calculator.toResponse(target);
  }

  async current(companyId: string): Promise<SalesTargetResponse[]> {
    const now = new Date();
    const rows = await this.prisma.salesTarget.findMany({
      where: { isActive: true, ...tenantWhere(companyId) },
      select: SALES_TARGET_SELECT,
      orderBy: { createdAt: "desc" },
    });

    const mapped = await Promise.all(
      rows.map((r) => this.calculator.toResponse(r)),
    );
    return mapped.filter((m) => {
      const start = new Date(m.startDate);
      const end = new Date(m.endDate);
      return start <= now && now <= end;
    });
  }

  async create(
    companyId: string,
    userId: string,
    dto: CreateSalesTargetDto,
  ): Promise<SalesTargetResponse> {
    await this.calculator.assertReferences(companyId, dto);

    const period = dto.period ?? derivePeriod(dto.type, dto.startDate);
    const targetRevenue = dto.targetRevenue ?? dto.targetAmount ?? null;

    try {
      const created = await this.prisma.salesTarget.create({
        data: {
          userId: dto.userId ?? null,
          branchId: dto.branchId ?? null,
          type: dto.type,
          targetRevenue,
          targetTx: dto.targetTx ?? null,
          targetItems: dto.targetItems ?? null,
          period,
          isActive: dto.isActive ?? true,
          createdBy: userId,
        },
        select: SALES_TARGET_SELECT,
      });
      return this.calculator.toResponse(created);
    } catch (err) {
      throwOnDup(err);
      throw err;
    }
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateSalesTargetDto,
  ): Promise<SalesTargetResponse> {
    const existing = await this.prisma.salesTarget.findFirst({
      where: { id, ...tenantWhere(companyId) },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Sales target not found");

    await this.calculator.assertReferences(companyId, dto);

    const data: Prisma.SalesTargetUpdateInput = {};
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.userId !== undefined) {
      data.user = dto.userId
        ? { connect: { id: dto.userId } }
        : { disconnect: true };
    }
    if (dto.branchId !== undefined) {
      data.branch = dto.branchId
        ? { connect: { id: dto.branchId } }
        : { disconnect: true };
    }
    if (dto.targetRevenue !== undefined) data.targetRevenue = dto.targetRevenue;
    if (dto.targetAmount !== undefined && dto.targetRevenue === undefined) {
      data.targetRevenue = dto.targetAmount;
    }
    if (dto.targetTx !== undefined) data.targetTx = dto.targetTx;
    if (dto.targetItems !== undefined) data.targetItems = dto.targetItems;
    if (dto.period !== undefined) data.period = dto.period;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    try {
      const updated = await this.prisma.salesTarget.update({
        where: { id },
        data,
        select: SALES_TARGET_SELECT,
      });
      return this.calculator.toResponse(updated);
    } catch (err) {
      throwOnDup(err);
      throw err;
    }
  }

  async recompute(
    companyId: string,
    id: string,
  ): Promise<SalesTargetResponse> {
    const existing = await this.prisma.salesTarget.findFirst({
      where: { id, ...tenantWhere(companyId) },
      select: SALES_TARGET_SELECT,
    });
    if (!existing) throw new NotFoundException("Sales target not found");

    const { start, end } = getPeriodRange(existing.type, existing.period);
    const achieved = await this.calculator.compute(
      companyId,
      existing.userId,
      existing.branchId,
      start,
      end,
    );

    const now = new Date();
    const targetRev = existing.targetRevenue ?? 0;
    let isActive = existing.isActive;
    if (targetRev > 0 && achieved.revenue >= targetRev) {
      isActive = false;
    } else if (now > end) {
      isActive = false;
    } else {
      isActive = true;
    }

    const updated = await this.prisma.salesTarget.update({
      where: { id },
      data: { isActive },
      select: SALES_TARGET_SELECT,
    });

    return this.calculator.toResponse(updated, achieved);
  }

  async delete(
    companyId: string,
    id: string,
  ): Promise<{ success: true }> {
    const existing = await this.prisma.salesTarget.findFirst({
      where: { id, ...tenantWhere(companyId) },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Sales target not found");
    await this.prisma.salesTarget.delete({ where: { id } });
    return { success: true };
  }
}
