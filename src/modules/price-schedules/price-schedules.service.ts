import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  ApplyDuePriceSchedulesResponse,
  CreatePriceScheduleDto,
  ListPriceSchedulesQueryDto,
  PriceScheduleListResponse,
  PriceScheduleResponse,
  RevertExpiredPriceSchedulesResponse,
  UpdatePriceScheduleDto,
} from "@/contracts";
import { PrismaService } from "../prisma/prisma.service";

const PRICE_SCHEDULE_SELECT = {
  id: true,
  productId: true,
  product: { select: { id: true, name: true, code: true } },
  branchId: true,
  branch: { select: { id: true, name: true } },
  newPrice: true,
  originalPrice: true,
  startDate: true,
  endDate: true,
  reason: true,
  isActive: true,
  appliedAt: true,
  revertedAt: true,
  createdAt: true,
} satisfies Prisma.PriceScheduleSelect;

type RawPriceSchedule = Prisma.PriceScheduleGetPayload<{
  select: typeof PRICE_SCHEDULE_SELECT;
}>;

@Injectable()
export class PriceSchedulesService {
  constructor(private readonly prisma: PrismaService) {}

  // PriceSchedule has nullable companyId; legacy rows may be NULL.
  // Use OR for company match + legacy NULL-with-tenant-product fallback.
  private tenantWhere(companyId: string): Prisma.PriceScheduleWhereInput {
    return {
      OR: [
        { companyId },
        { companyId: null, product: { is: { companyId } } },
      ],
    };
  }

  async list(
    companyId: string,
    query: ListPriceSchedulesQueryDto,
  ): Promise<PriceScheduleListResponse> {
    const {
      search,
      productId,
      branchId,
      isActive,
      applied,
      from,
      to,
      page,
      perPage,
    } = query;

    const where: Prisma.PriceScheduleWhereInput = {
      ...this.tenantWhere(companyId),
    };
    if (productId) where.productId = productId;
    if (branchId) where.branchId = branchId;
    if (isActive !== undefined) where.isActive = isActive;
    if (applied !== undefined) {
      where.appliedAt = applied ? { not: null } : null;
    }
    if (search) {
      where.product = {
        is: { name: { contains: search, mode: "insensitive" } },
      };
    }
    if (from || to) {
      where.startDate = {};
      if (from) where.startDate.gte = new Date(from);
      if (to) where.startDate.lte = new Date(to);
    }

    const [rows, total] = await Promise.all([
      this.prisma.priceSchedule.findMany({
        where,
        select: PRICE_SCHEDULE_SELECT,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.priceSchedule.count({ where }),
    ]);

    return {
      schedules: rows.map(toPriceScheduleResponse),
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<PriceScheduleResponse> {
    const row = await this.prisma.priceSchedule.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: PRICE_SCHEDULE_SELECT,
    });
    if (!row) throw new NotFoundException("Price schedule not found");
    return toPriceScheduleResponse(row);
  }

  // Schedules due in the next 24h (active + not yet applied).
  async upcoming(companyId: string): Promise<PriceScheduleResponse[]> {
    const now = new Date();
    const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const rows = await this.prisma.priceSchedule.findMany({
      where: {
        ...this.tenantWhere(companyId),
        isActive: true,
        appliedAt: null,
        startDate: { lte: horizon },
      },
      select: PRICE_SCHEDULE_SELECT,
      orderBy: { startDate: "asc" },
    });
    return rows.map(toPriceScheduleResponse);
  }

  async create(
    companyId: string,
    actorId: string,
    dto: CreatePriceScheduleDto,
  ): Promise<PriceScheduleResponse> {
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, companyId, deletedAt: null },
      select: { id: true, sellingPrice: true },
    });
    if (!product) throw new NotFoundException("Product not found");

    if (dto.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: dto.branchId, companyId },
        select: { id: true },
      });
      if (!branch) throw new NotFoundException("Branch not found");
    }

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (endDate <= startDate) {
      throw new BadRequestException("endDate harus > startDate");
    }

    const newPrice = dto.newPrice ?? dto.scheduledPrice;
    if (newPrice == null) {
      throw new BadRequestException("scheduledPrice/newPrice wajib diisi");
    }
    const reason = dto.reason ?? dto.notes ?? null;

    try {
      const created = await this.prisma.priceSchedule.create({
        data: {
          productId: dto.productId,
          branchId: dto.branchId ?? null,
          companyId,
          newPrice,
          originalPrice: product.sellingPrice,
          startDate,
          endDate,
          reason,
          isActive: dto.isActive ?? true,
          createdBy: actorId,
        },
        select: PRICE_SCHEDULE_SELECT,
      });
      return toPriceScheduleResponse(created);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new ConflictException(
          "Jadwal harga sudah ada untuk produk/branch tersebut",
        );
      }
      throw err;
    }
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdatePriceScheduleDto,
  ): Promise<PriceScheduleResponse> {
    const existing = await this.prisma.priceSchedule.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: {
        id: true,
        appliedAt: true,
        startDate: true,
        endDate: true,
      },
    });
    if (!existing) throw new NotFoundException("Price schedule not found");
    if (existing.appliedAt) {
      throw new BadRequestException(
        "Jadwal sudah diterapkan, tidak bisa diubah",
      );
    }

    if (dto.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: dto.branchId, companyId },
        select: { id: true },
      });
      if (!branch) throw new NotFoundException("Branch not found");
    }

    const data: Prisma.PriceScheduleUpdateInput = {};
    const newPrice = dto.newPrice ?? dto.scheduledPrice;
    if (newPrice !== undefined) data.newPrice = newPrice;
    if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) data.endDate = new Date(dto.endDate);
    if (dto.reason !== undefined) data.reason = dto.reason;
    else if (dto.notes !== undefined) data.reason = dto.notes;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.branchId !== undefined) {
      data.branch = dto.branchId
        ? { connect: { id: dto.branchId } }
        : { disconnect: true };
    }

    // Validate range across patched + existing values.
    const finalStart =
      dto.startDate !== undefined ? new Date(dto.startDate) : existing.startDate;
    const finalEnd =
      dto.endDate !== undefined ? new Date(dto.endDate) : existing.endDate;
    if (finalEnd <= finalStart) {
      throw new BadRequestException("endDate harus > startDate");
    }

    const updated = await this.prisma.priceSchedule.update({
      where: { id },
      data,
      select: PRICE_SCHEDULE_SELECT,
    });
    return toPriceScheduleResponse(updated);
  }

  // Atomic: stamp price into Product (or BranchProductPrice when branchId set).
  async apply(
    companyId: string,
    id: string,
  ): Promise<PriceScheduleResponse> {
    const existing = await this.prisma.priceSchedule.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: {
        id: true,
        productId: true,
        branchId: true,
        newPrice: true,
        originalPrice: true,
        startDate: true,
        endDate: true,
        appliedAt: true,
      },
    });
    if (!existing) throw new NotFoundException("Price schedule not found");
    if (existing.appliedAt) {
      throw new ConflictException("Jadwal harga sudah diterapkan");
    }
    const now = new Date();
    if (now < existing.startDate) {
      throw new BadRequestException(
        "Belum waktunya â€” jadwal mulai berlaku setelah startDate",
      );
    }
    if (now > existing.endDate) {
      throw new BadRequestException("Jadwal sudah lewat endDate");
    }

    await this.prisma.$transaction(async (tx) => {
      if (existing.branchId) {
        await tx.branchProductPrice.upsert({
          where: {
            branchId_productId: {
              branchId: existing.branchId,
              productId: existing.productId,
            },
          },
          create: {
            branchId: existing.branchId,
            productId: existing.productId,
            sellingPrice: existing.newPrice,
          },
          update: { sellingPrice: existing.newPrice },
        });
      } else {
        await tx.product.update({
          where: { id: existing.productId },
          data: { sellingPrice: existing.newPrice },
        });
      }
      await tx.priceSchedule.update({
        where: { id },
        data: { appliedAt: now },
      });
    });

    const refreshed = await this.prisma.priceSchedule.findUniqueOrThrow({
      where: { id },
      select: PRICE_SCHEDULE_SELECT,
    });
    return toPriceScheduleResponse(refreshed);
  }

  async delete(
    companyId: string,
    id: string,
  ): Promise<{ success: true }> {
    const existing = await this.prisma.priceSchedule.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: { id: true, appliedAt: true },
    });
    if (!existing) throw new NotFoundException("Price schedule not found");
    if (existing.appliedAt) {
      throw new BadRequestException(
        "Jadwal sudah diterapkan, tidak bisa dihapus",
      );
    }
    await this.prisma.priceSchedule.delete({ where: { id } });
    return { success: true };
  }

  // â”€â”€ Cron-like batch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Apply schedules yang sudah due (startDate <= now & belum applied), lalu
  // revert yang sudah expired (endDate <= now & belum reverted).
  async applyDue(companyId: string): Promise<ApplyDuePriceSchedulesResponse> {
    const now = new Date();

    const dueSchedules = await this.prisma.priceSchedule.findMany({
      where: {
        ...this.tenantWhere(companyId),
        isActive: true,
        appliedAt: null,
        startDate: { lte: now },
      },
      select: {
        id: true,
        productId: true,
        branchId: true,
        newPrice: true,
        originalPrice: true,
      },
    });

    let appliedCount = 0;
    for (const s of dueSchedules) {
      await this.prisma.$transaction(async (tx) => {
        if (s.branchId) {
          await tx.branchProductPrice.upsert({
            where: {
              branchId_productId: {
                branchId: s.branchId,
                productId: s.productId,
              },
            },
            create: {
              branchId: s.branchId,
              productId: s.productId,
              sellingPrice: s.newPrice,
            },
            update: { sellingPrice: s.newPrice },
          });
        } else {
          await tx.product.update({
            where: { id: s.productId },
            data: { sellingPrice: s.newPrice },
          });
        }
        await tx.priceSchedule.update({
          where: { id: s.id },
          data: { appliedAt: now },
        });
      });
      appliedCount++;
    }

    const revertResult = await this.revertExpired(companyId);
    return {
      success: true,
      appliedCount,
      revertedCount: revertResult.revertedCount,
    };
  }

  // Revert harga yang sudah expired ke originalPrice.
  async revertExpired(
    companyId: string,
  ): Promise<RevertExpiredPriceSchedulesResponse> {
    const now = new Date();

    const expiredSchedules = await this.prisma.priceSchedule.findMany({
      where: {
        ...this.tenantWhere(companyId),
        isActive: true,
        appliedAt: { not: null },
        revertedAt: null,
        endDate: { lte: now },
      },
      select: {
        id: true,
        productId: true,
        branchId: true,
        originalPrice: true,
      },
    });

    let revertedCount = 0;
    for (const s of expiredSchedules) {
      await this.prisma.$transaction(async (tx) => {
        if (s.branchId) {
          await tx.branchProductPrice.upsert({
            where: {
              branchId_productId: {
                branchId: s.branchId,
                productId: s.productId,
              },
            },
            create: {
              branchId: s.branchId,
              productId: s.productId,
              sellingPrice: s.originalPrice,
            },
            update: { sellingPrice: s.originalPrice },
          });
        } else {
          await tx.product.update({
            where: { id: s.productId },
            data: { sellingPrice: s.originalPrice },
          });
        }
        await tx.priceSchedule.update({
          where: { id: s.id },
          data: { revertedAt: now },
        });
      });
      revertedCount++;
    }

    return { success: true, revertedCount };
  }
}

function toPriceScheduleResponse(p: RawPriceSchedule): PriceScheduleResponse {
  return {
    id: p.id,
    productId: p.productId,
    product: p.product
      ? { id: p.product.id, name: p.product.name, code: p.product.code }
      : null,
    branchId: p.branchId,
    branch: p.branch ? { id: p.branch.id, name: p.branch.name } : null,
    scheduledPrice: p.newPrice,
    newPrice: p.newPrice,
    originalPrice: p.originalPrice,
    startDate: p.startDate.toISOString(),
    endDate: p.endDate.toISOString(),
    isActive: p.isActive,
    applied: p.appliedAt != null,
    appliedAt: p.appliedAt ? p.appliedAt.toISOString() : null,
    revertedAt: p.revertedAt ? p.revertedAt.toISOString() : null,
    notes: p.reason,
    reason: p.reason,
    createdAt: p.createdAt.toISOString(),
  };
}
