import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const AUDIT_LOG_SELECT = {
  id: true,
  userId: true,
  branchId: true,
  action: true,
  entity: true,
  entityId: true,
  details: true,
  ipAddress: true,
  userAgent: true,
  createdAt: true,
  user: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
} satisfies Prisma.AuditLogSelect;

export type RawAuditLog = Prisma.AuditLogGetPayload<{
  select: typeof AUDIT_LOG_SELECT;
}>;

export const ACTIVITY_LOG_SELECT = {
  id: true,
  userId: true,
  action: true,
  description: true,
  metadata: true,
  createdAt: true,
  user: { select: { id: true, name: true } },
} satisfies Prisma.ActivityLogSelect;

export type RawActivityLog = Prisma.ActivityLogGetPayload<{
  select: typeof ACTIVITY_LOG_SELECT;
}>;

@Injectable()
export class AuditLogsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ===========================
  // AuditLog
  // ===========================

  async findManyAuditLogs(
    where: Prisma.AuditLogWhereInput,
    skip: number,
    take: number,
  ): Promise<RawAuditLog[]> {
    return this.prisma.auditLog.findMany({
      where,
      select: AUDIT_LOG_SELECT,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });
  }

  async countAuditLogs(where: Prisma.AuditLogWhereInput): Promise<number> {
    return this.prisma.auditLog.count({ where });
  }

  async findOneAuditLog(
    where: Prisma.AuditLogWhereInput,
  ): Promise<RawAuditLog | null> {
    return this.prisma.auditLog.findFirst({
      where,
      select: AUDIT_LOG_SELECT,
    });
  }

  async findAuditLogsByEntity(
    where: Prisma.AuditLogWhereInput,
  ): Promise<RawAuditLog[]> {
    return this.prisma.auditLog.findMany({
      where,
      select: AUDIT_LOG_SELECT,
      orderBy: { createdAt: "desc" },
    });
  }

  async groupByAction(where: Prisma.AuditLogWhereInput) {
    return this.prisma.auditLog.groupBy({
      by: ["action"],
      where,
      _count: { _all: true },
      orderBy: { _count: { action: "desc" } },
    });
  }

  async groupByEntity(where: Prisma.AuditLogWhereInput) {
    return this.prisma.auditLog.groupBy({
      by: ["entity"],
      where,
      _count: { _all: true },
      orderBy: { _count: { entity: "desc" } },
    });
  }

  async groupByUser(where: Prisma.AuditLogWhereInput, take: number) {
    return this.prisma.auditLog.groupBy({
      by: ["userId"],
      where,
      _count: { _all: true },
      orderBy: { _count: { userId: "desc" } },
      take,
    });
  }

  async findUsersByIds(
    ids: string[],
  ): Promise<Array<{ id: string; name: string }>> {
    if (!ids.length) return [];
    return this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
  }

  // ===========================
  // ActivityLog
  // ===========================

  async findManyActivityLogs(
    where: Prisma.ActivityLogWhereInput,
    skip: number,
    take: number,
  ): Promise<RawActivityLog[]> {
    return this.prisma.activityLog.findMany({
      where,
      select: ACTIVITY_LOG_SELECT,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    });
  }

  async countActivityLogs(
    where: Prisma.ActivityLogWhereInput,
  ): Promise<number> {
    return this.prisma.activityLog.count({ where });
  }

  async findOneActivityLog(
    where: Prisma.ActivityLogWhereInput,
  ): Promise<RawActivityLog | null> {
    return this.prisma.activityLog.findFirst({
      where,
      select: ACTIVITY_LOG_SELECT,
    });
  }

  async createActivityLog(
    data: Prisma.ActivityLogUncheckedCreateInput,
  ): Promise<RawActivityLog> {
    return this.prisma.activityLog.create({
      data,
      select: ACTIVITY_LOG_SELECT,
    });
  }
}
