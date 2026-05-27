import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { throwIfUniqueConstraint } from "@/common/utils/prisma-errors";
import type {
  BulkCreateEmployeeScheduleResponse,
  BulkCreateEmployeeSchedulesDto,
  CreateEmployeeScheduleDto,
  EmployeeScheduleResponse,
  ListEmployeeSchedulesQueryDto,
  ScheduleStatusDto,
  UpdateEmployeeScheduleDto,
} from "./dto/employee-schedules.dto";
import type { PaginatedResponse } from "@/common/types/response";
import { paginate } from "@/common/utils/pagination";
import {
  EmployeeSchedulesRepository,
  type RawSchedule,
} from "./employee-schedules.repository";

const SHIFT_LABEL_BY_TYPE: Record<string, string> = {
  MORNING: "Pagi",
  AFTERNOON: "Siang",
  EVENING: "Sore",
  NIGHT: "Malam",
  FULL_DAY: "Full Day",
};

@Injectable()
export class EmployeeSchedulesService {
  constructor(private readonly repo: EmployeeSchedulesRepository) {}

  // No companyId column on EmployeeSchedule — scope through user.companyId.
  private tenantWhere(companyId: string): Prisma.EmployeeScheduleWhereInput {
    return { user: { is: { companyId } } };
  }

  async list(
    companyId: string,
    query: ListEmployeeSchedulesQueryDto,
  ): Promise<PaginatedResponse<EmployeeScheduleResponse>> {
    const { search, userId, branchId, status, from, to, page, perPage } =
      query;

    const where: Prisma.EmployeeScheduleWhereInput = {
      ...this.tenantWhere(companyId),
    };
    if (userId) where.userId = userId;
    if (branchId) where.branchId = branchId;
    if (status) where.status = status;
    if (search) {
      where.user = {
        is: {
          companyId,
          OR: [
            { name: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
          ],
        },
      };
    }
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = parseLocalDate(from);
      if (to) where.date.lte = parseLocalDate(to);
    }

    const [rows, total] = await Promise.all([
      this.repo.findMany(where, { date: "desc" }, (page - 1) * perPage, perPage),
      this.repo.count(where),
    ]);

    return paginate(rows.map(toScheduleResponse), total, page, perPage);
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<EmployeeScheduleResponse> {
    const row = await this.repo.findOne({
      id,
      ...this.tenantWhere(companyId),
    });
    if (!row) throw new NotFoundException("Jadwal tidak ditemukan");
    return toScheduleResponse(row);
  }

  async byDate(
    companyId: string,
    date: string,
    branchId?: string,
  ): Promise<EmployeeScheduleResponse[]> {
    const day = parseLocalDate(date);
    const next = new Date(day);
    next.setDate(next.getDate() + 1);

    const where: Prisma.EmployeeScheduleWhereInput = {
      ...this.tenantWhere(companyId),
      date: { gte: day, lt: next },
    };
    if (branchId) where.branchId = branchId;

    const rows = await this.repo.findManyByWhere(where, [{ shiftStart: "asc" }]);
    return rows.map(toScheduleResponse);
  }

  async create(
    companyId: string,
    actorId: string,
    dto: CreateEmployeeScheduleDto,
  ): Promise<EmployeeScheduleResponse> {
    await this.assertReferences(companyId, dto.userId, dto.branchId);

    const data = this.buildCreateData(dto, actorId);

    try {
      const created = await this.repo.create(data);
      return toScheduleResponse(created);
    } catch (err) {
      throwIfUniqueConstraint(err, "Jadwal sudah ada untuk user ini di waktu tersebut");
    }
  }

  async bulkCreate(
    companyId: string,
    actorId: string,
    dto: BulkCreateEmployeeSchedulesDto,
  ): Promise<BulkCreateEmployeeScheduleResponse> {
    // Validate distinct userIds & branchIds against tenant.
    const userIds = Array.from(new Set(dto.schedules.map((s) => s.userId)));
    const branchIds = Array.from(
      new Set(
        dto.schedules
          .map((s) => s.branchId)
          .filter((b): b is string => !!b),
      ),
    );
    if (userIds.length) {
      const validUsers = await this.repo.countUsers({
        id: { in: userIds },
        companyId,
      });
      if (validUsers !== userIds.length) {
        throw new NotFoundException("Satu atau lebih pengguna tidak ditemukan");
      }
    }
    if (branchIds.length) {
      const validBranches = await this.repo.countBranches({
        id: { in: branchIds },
        companyId,
      });
      if (validBranches !== branchIds.length) {
        throw new NotFoundException("Satu atau lebih cabang tidak ditemukan");
      }
    }

    const rows = dto.schedules.map((s) => this.buildCreateData(s, actorId));
    const count = await this.repo.createMany(rows);
    return { created: count };
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateEmployeeScheduleDto,
  ): Promise<EmployeeScheduleResponse> {
    const existing = await this.repo.findExistence({
      id,
      ...this.tenantWhere(companyId),
    });
    if (!existing) throw new NotFoundException("Jadwal tidak ditemukan");

    if (dto.branchId) {
      await this.assertReferences(companyId, undefined, dto.branchId);
    }

    const data: Prisma.EmployeeScheduleUpdateInput = {};
    const dateStr = dto.shiftDate ?? dto.date;
    if (dateStr) data.date = parseLocalDate(dateStr);
    const start = dto.startTime ?? dto.shiftStart;
    const end = dto.endTime ?? dto.shiftEnd;
    if (start) data.shiftStart = start;
    if (end) data.shiftEnd = end;
    if (dto.shiftLabel !== undefined) {
      data.shiftLabel = dto.shiftLabel;
    } else if (dto.shiftType !== undefined && dto.shiftType !== null) {
      data.shiftLabel = SHIFT_LABEL_BY_TYPE[dto.shiftType] ?? dto.shiftType;
    }
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.branchId !== undefined) {
      data.branch = dto.branchId
        ? { connect: { id: dto.branchId } }
        : { disconnect: true };
    }

    try {
      const updated = await this.repo.update(id, data);
      return toScheduleResponse(updated);
    } catch (err) {
      throwIfUniqueConstraint(err, "Jadwal sudah ada untuk user ini di waktu tersebut");
    }
  }

  async updateStatus(
    companyId: string,
    id: string,
    status: ScheduleStatusDto,
  ): Promise<EmployeeScheduleResponse> {
    const existing = await this.repo.findExistence({
      id,
      ...this.tenantWhere(companyId),
    });
    if (!existing) throw new NotFoundException("Jadwal tidak ditemukan");

    const updated = await this.repo.update(id, { status });
    return toScheduleResponse(updated);
  }

  async delete(
    companyId: string,
    id: string,
  ): Promise<{ success: true }> {
    const existing = await this.repo.findExistence({
      id,
      ...this.tenantWhere(companyId),
    });
    if (!existing) throw new NotFoundException("Jadwal tidak ditemukan");
    await this.repo.delete(id);
    return { success: true };
  }

  // — Helpers ——————————————————————————————————————————————————

  private async assertReferences(
    companyId: string,
    userId?: string | null,
    branchId?: string | null,
  ) {
    if (userId) {
      const user = await this.repo.findUser({
        id: userId,
        companyId,
      });
      if (!user) throw new NotFoundException("Pengguna tidak ditemukan");
    }
    if (branchId) {
      const branch = await this.repo.findBranch({
        id: branchId,
        companyId,
      });
      if (!branch) throw new NotFoundException("Cabang tidak ditemukan");
    }
  }

  private buildCreateData(
    dto: CreateEmployeeScheduleDto,
    actorId: string,
  ): Prisma.EmployeeScheduleCreateManyInput {
    const dateStr = dto.shiftDate ?? dto.date;
    if (!dateStr) {
      throw new ConflictException("shiftDate atau date wajib diisi");
    }
    const start = dto.startTime ?? dto.shiftStart;
    const end = dto.endTime ?? dto.shiftEnd;
    if (!start || !end) {
      throw new ConflictException(
        "startTime/endTime (atau shiftStart/shiftEnd) wajib diisi",
      );
    }
    const shiftLabel =
      dto.shiftLabel ??
      (dto.shiftType ? SHIFT_LABEL_BY_TYPE[dto.shiftType] ?? dto.shiftType : null);

    return {
      userId: dto.userId,
      branchId: dto.branchId ?? null,
      date: parseLocalDate(dateStr),
      shiftStart: start,
      shiftEnd: end,
      shiftLabel,
      status: dto.status ?? "SCHEDULED",
      notes: dto.notes ?? null,
      createdBy: actorId,
    };
  }
}

function toScheduleResponse(s: RawSchedule): EmployeeScheduleResponse {
  const dateIso = s.date.toISOString();
  const dateOnly = dateIso.slice(0, 10);
  return {
    id: s.id,
    userId: s.userId,
    user: s.user
      ? {
          id: s.user.id,
          name: s.user.name,
          email: s.user.email,
          role: s.user.role,
        }
      : null,
    branchId: s.branchId,
    branch: s.branch ? { id: s.branch.id, name: s.branch.name } : null,
    date: dateOnly,
    shiftDate: dateOnly,
    shiftStart: s.shiftStart,
    shiftEnd: s.shiftEnd,
    startTime: s.shiftStart,
    endTime: s.shiftEnd,
    shiftLabel: s.shiftLabel,
    shiftType: s.shiftLabel,
    status: s.status,
    notes: s.notes,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

// "YYYY-MM-DD" or ISO datetime → Date at noon UTC (mirrors web action).
function parseLocalDate(input: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return new Date(`${input}T12:00:00.000Z`);
  }
  return new Date(input);
}
