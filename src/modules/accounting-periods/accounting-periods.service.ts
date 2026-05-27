import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { throwIfUniqueConstraint } from "@/common/utils/prisma-errors";
import type { PaginatedResponse } from "@/common/types/response";
import { paginate } from "@/common/utils/pagination";
import type {
  AccountingPeriodResponse,
  CreateAccountingPeriodDto,
  ListAccountingPeriodsQueryDto,
  UpdateAccountingPeriodDto,
} from "./dto/accounting-periods.dto";
import {
  AccountingPeriodsRepository,
  type RawPeriod,
} from "./accounting-periods.repository";

@Injectable()
export class AccountingPeriodsService {
  constructor(private readonly repo: AccountingPeriodsRepository) {}

  async list(
    companyId: string,
    query: ListAccountingPeriodsQueryDto,
  ): Promise<PaginatedResponse<AccountingPeriodResponse>> {
    const { search, status, from, to, page, perPage, sortBy, sortDir } = query;
    const where: Prisma.AccountingPeriodWhereInput = { companyId };
    if (status) where.status = status;
    if (search) {
      where.name = { contains: search, mode: "insensitive" };
    }
    if (from || to) {
      // Overlap: period.startDate <= to AND period.endDate >= from
      const fromDate = from ? new Date(from) : undefined;
      const toDate = to ? new Date(to) : undefined;
      const overlapAnd: Prisma.AccountingPeriodWhereInput[] = [];
      if (toDate) overlapAnd.push({ startDate: { lte: toDate } });
      if (fromDate) overlapAnd.push({ endDate: { gte: fromDate } });
      where.AND = overlapAnd;
    }

    const dir: "asc" | "desc" = sortDir ?? "asc";
    let orderBy:
      | Prisma.AccountingPeriodOrderByWithRelationInput
      | Prisma.AccountingPeriodOrderByWithRelationInput[] = [
      { startDate: "desc" },
    ];
    if (sortBy) {
      switch (sortBy) {
        case "name":
        case "startDate":
        case "endDate":
        case "status":
        case "createdAt":
          orderBy = {
            [sortBy]: dir,
          } as Prisma.AccountingPeriodOrderByWithRelationInput;
          break;
      }
    }

    const [rows, total] = await Promise.all([
      this.repo.findMany(where, orderBy, (page - 1) * perPage, perPage),
      this.repo.count(where),
    ]);

    return paginate(rows.map(toPeriodResponse), total, page, perPage);
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<AccountingPeriodResponse> {
    const period = await this.repo.findOne({ id, companyId });
    if (!period)
      throw new NotFoundException("Periode akuntansi tidak ditemukan");
    return toPeriodResponse(period);
  }

  async findCurrent(
    companyId: string,
  ): Promise<AccountingPeriodResponse | null> {
    const now = new Date();
    const period = await this.repo.findOneOrdered(
      {
        companyId,
        status: "OPEN",
        startDate: { lte: now },
        endDate: { gte: now },
      },
      { startDate: "desc" },
    );
    return period ? toPeriodResponse(period) : null;
  }

  async create(
    companyId: string,
    dto: CreateAccountingPeriodDto,
  ): Promise<AccountingPeriodResponse> {
    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (endDate.getTime() <= startDate.getTime()) {
      throw new BadRequestException(
        "Tanggal akhir harus lebih besar dari tanggal mulai",
      );
    }

    // Check overlap with existing OPEN/CLOSED periods (LOCKED also counts as active history)
    const overlap = await this.repo.findOverlap(companyId, startDate, endDate);
    if (overlap) {
      throw new ConflictException(
        `Periode tumpang tindih dengan periode existing: ${overlap.name}`,
      );
    }

    try {
      const created = await this.repo.create({
        name: dto.name,
        startDate,
        endDate,
        status: "OPEN",
        companyId,
      });
      return toPeriodResponse(created);
    } catch (err) {
      throwIfDuplicate(err);
      throw err;
    }
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateAccountingPeriodDto,
  ): Promise<AccountingPeriodResponse> {
    const existing = await this.repo.findStatusWithDates(companyId, id);
    if (!existing) {
      throw new NotFoundException("Periode akuntansi tidak ditemukan");
    }
    if (existing.status === "CLOSED" || existing.status === "LOCKED") {
      throw new BadRequestException(
        "Periode yang sudah CLOSED atau LOCKED tidak dapat diubah",
      );
    }

    const startDate = dto.startDate
      ? new Date(dto.startDate)
      : existing.startDate;
    const endDate = dto.endDate ? new Date(dto.endDate) : existing.endDate;
    if (endDate.getTime() <= startDate.getTime()) {
      throw new BadRequestException(
        "Tanggal akhir harus lebih besar dari tanggal mulai",
      );
    }

    if (dto.startDate || dto.endDate) {
      const overlap = await this.repo.findOverlap(
        companyId,
        startDate,
        endDate,
        id,
      );
      if (overlap) {
        throw new ConflictException(
          `Periode tumpang tindih dengan periode existing: ${overlap.name}`,
        );
      }
    }

    const data: Prisma.AccountingPeriodUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.startDate !== undefined) data.startDate = startDate;
    if (dto.endDate !== undefined) data.endDate = endDate;

    try {
      const updated = await this.repo.update(id, data);
      return toPeriodResponse(updated);
    } catch (err) {
      throwIfDuplicate(err);
      throw err;
    }
  }

  async close(
    companyId: string,
    id: string,
    userId: string,
  ): Promise<AccountingPeriodResponse> {
    const existing = await this.repo.findStatus(companyId, id);
    if (!existing) {
      throw new NotFoundException("Periode akuntansi tidak ditemukan");
    }
    if (existing.status !== "OPEN") {
      throw new BadRequestException(
        "Hanya periode dengan status OPEN yang dapat di-close",
      );
    }

    const updated = await this.repo.update(id, {
      status: "CLOSED",
      closedAt: new Date(),
      closedBy: userId,
    });
    return toPeriodResponse(updated);
  }

  async reopen(
    companyId: string,
    id: string,
  ): Promise<AccountingPeriodResponse> {
    const existing = await this.repo.findStatusWithDates(companyId, id);
    if (!existing) {
      throw new NotFoundException("Periode akuntansi tidak ditemukan");
    }
    if (existing.status === "LOCKED") {
      throw new BadRequestException("Periode LOCKED tidak dapat di-reopen");
    }
    if (existing.status !== "CLOSED") {
      throw new BadRequestException(
        "Hanya periode dengan status CLOSED yang dapat di-reopen",
      );
    }

    // Reject if there is a later period that is already CLOSED
    const laterClosed = await this.repo.findLaterClosed(
      companyId,
      id,
      existing.endDate,
    );
    if (laterClosed) {
      throw new BadRequestException(
        `Tidak dapat reopen karena ada periode setelahnya yang sudah CLOSED: ${laterClosed.name}`,
      );
    }

    const updated = await this.repo.update(id, {
      status: "OPEN",
      closedAt: null,
      closedBy: null,
    });
    return toPeriodResponse(updated);
  }

  async lock(
    companyId: string,
    id: string,
  ): Promise<AccountingPeriodResponse> {
    const existing = await this.repo.findStatus(companyId, id);
    if (!existing) {
      throw new NotFoundException("Periode akuntansi tidak ditemukan");
    }
    if (existing.status !== "CLOSED") {
      throw new BadRequestException(
        "Hanya periode dengan status CLOSED yang dapat di-lock",
      );
    }

    const updated = await this.repo.update(id, { status: "LOCKED" });
    return toPeriodResponse(updated);
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const existing = await this.repo.findStatus(companyId, id);
    if (!existing) {
      throw new NotFoundException("Periode akuntansi tidak ditemukan");
    }
    if (existing.status !== "OPEN") {
      throw new BadRequestException(
        "Hanya periode dengan status OPEN yang dapat dihapus",
      );
    }

    const journalCount = await this.repo.countJournals(id);
    if (journalCount > 0) {
      throw new BadRequestException(
        `Periode tidak dapat dihapus karena sudah memiliki ${journalCount} jurnal terkait`,
      );
    }

    await this.repo.delete(id);
    return { success: true };
  }
}

function toPeriodResponse(p: RawPeriod): AccountingPeriodResponse {
  return {
    id: p.id,
    name: p.name,
    startDate: p.startDate.toISOString(),
    endDate: p.endDate.toISOString(),
    status: p.status,
    closedAt: p.closedAt ? p.closedAt.toISOString() : null,
    closedBy: p.closedBy ?? null,
    journalCount: p._count.journals,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function throwIfDuplicate(err: unknown): void {
  throwIfUniqueConstraint(err, "Periode dengan tanggal yang sama sudah ada");
}
