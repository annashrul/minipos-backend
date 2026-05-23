import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  ActivityLogListResponse,
  ActivityLogResponse,
  AuditLogListResponse,
  AuditLogResponse,
  AuditLogSummaryResponse,
  AuditSummaryQueryDto,
  CreateActivityLogDto,
  ListActivityLogsQueryDto,
  ListAuditLogsQueryDto,
} from "./dto/audit-logs.dto";
import { PrismaService } from "../prisma/prisma.service";

const AUDIT_LOG_SELECT = {
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

type RawAuditLog = Prisma.AuditLogGetPayload<{
  select: typeof AUDIT_LOG_SELECT;
}>;

const ACTIVITY_LOG_SELECT = {
  id: true,
  userId: true,
  action: true,
  description: true,
  metadata: true,
  createdAt: true,
  user: { select: { id: true, name: true } },
} satisfies Prisma.ActivityLogSelect;

type RawActivityLog = Prisma.ActivityLogGetPayload<{
  select: typeof ACTIVITY_LOG_SELECT;
}>;

@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  // ===========================
  // AuditLog
  // ===========================

  async listAuditLogs(
    companyId: string,
    query: ListAuditLogsQueryDto,
  ): Promise<AuditLogListResponse> {
    const where = this.buildAuditWhere(companyId, query);

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        select: AUDIT_LOG_SELECT,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      logs: rows.map(toAuditLogResponse),
      total,
      totalPages: Math.ceil(total / query.perPage),
    };
  }

  async findAuditLog(
    companyId: string,
    id: string,
  ): Promise<AuditLogResponse> {
    const row = await this.prisma.auditLog.findFirst({
      where: { id, ...this.auditTenantWhere(companyId) },
      select: AUDIT_LOG_SELECT,
    });
    if (!row) throw new NotFoundException("Audit log not found");
    return toAuditLogResponse(row);
  }

  async findByEntity(
    companyId: string,
    entity: string,
    entityId: string,
  ): Promise<AuditLogResponse[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        entity,
        entityId,
        ...this.auditTenantWhere(companyId),
      },
      select: AUDIT_LOG_SELECT,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toAuditLogResponse);
  }

  async summary(
    companyId: string,
    query: AuditSummaryQueryDto,
  ): Promise<AuditLogSummaryResponse> {
    const where: Prisma.AuditLogWhereInput = this.auditTenantWhere(companyId);
    if (query.branchId) where.branchId = query.branchId;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    const [total, byActionRaw, byEntityRaw, byUserRaw] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.groupBy({
        by: ["action"],
        where,
        _count: { _all: true },
        orderBy: { _count: { action: "desc" } },
      }),
      this.prisma.auditLog.groupBy({
        by: ["entity"],
        where,
        _count: { _all: true },
        orderBy: { _count: { entity: "desc" } },
      }),
      this.prisma.auditLog.groupBy({
        by: ["userId"],
        where,
        _count: { _all: true },
        orderBy: { _count: { userId: "desc" } },
        take: 20,
      }),
    ]);

    const userIds = byUserRaw.map((u) => u.userId);
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true },
        })
      : [];
    const userMap = new Map(users.map((u) => [u.id, u.name]));

    return {
      total,
      byAction: byActionRaw.map((r) => ({
        action: r.action,
        count: r._count._all,
      })),
      byEntity: byEntityRaw.map((r) => ({
        entity: r.entity,
        count: r._count._all,
      })),
      byUser: byUserRaw.map((r) => ({
        userId: r.userId,
        userName: userMap.get(r.userId) ?? "",
        count: r._count._all,
      })),
    };
  }

  // ===========================
  // ActivityLog
  // ===========================

  async listActivityLogs(
    companyId: string,
    query: ListActivityLogsQueryDto,
  ): Promise<ActivityLogListResponse> {
    const where = this.buildActivityWhere(companyId, query);

    const [rows, total] = await Promise.all([
      this.prisma.activityLog.findMany({
        where,
        select: ACTIVITY_LOG_SELECT,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      this.prisma.activityLog.count({ where }),
    ]);

    return {
      logs: rows.map(toActivityLogResponse),
      total,
      totalPages: Math.ceil(total / query.perPage),
    };
  }

  async findActivityLog(
    companyId: string,
    id: string,
  ): Promise<ActivityLogResponse> {
    const row = await this.prisma.activityLog.findFirst({
      where: { id, user: { companyId } },
      select: ACTIVITY_LOG_SELECT,
    });
    if (!row) throw new NotFoundException("Activity log not found");
    return toActivityLogResponse(row);
  }

  async createActivityLog(
    userId: string,
    dto: CreateActivityLogDto,
  ): Promise<ActivityLogResponse> {
    const metadata = serializeMetadata(dto.metadata);
    const created = await this.prisma.activityLog.create({
      data: {
        userId,
        action: dto.action,
        description: dto.description ?? null,
        metadata,
      },
      select: ACTIVITY_LOG_SELECT,
    });
    return toActivityLogResponse(created);
  }

  // ===========================
  // Helpers
  // ===========================

  private auditTenantWhere(companyId: string): Prisma.AuditLogWhereInput {
    return {
      OR: [
        { user: { companyId } },
        { branch: { companyId } },
      ],
    };
  }

  private buildAuditWhere(
    companyId: string,
    query: ListAuditLogsQueryDto,
  ): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = this.auditTenantWhere(companyId);
    if (query.userId) where.userId = query.userId;
    if (query.branchId) where.branchId = query.branchId;
    if (query.entity) where.entity = query.entity;
    if (query.entityId) where.entityId = query.entityId;
    if (query.action) where.action = query.action;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }
    if (query.search) {
      const s = query.search;
      where.AND = [
        {
          OR: [
            { entity: { contains: s, mode: "insensitive" } },
            { entityId: { contains: s, mode: "insensitive" } },
            { action: { contains: s, mode: "insensitive" } },
          ],
        },
      ];
    }
    return where;
  }

  private buildActivityWhere(
    companyId: string,
    query: ListActivityLogsQueryDto,
  ): Prisma.ActivityLogWhereInput {
    const where: Prisma.ActivityLogWhereInput = {
      user: { companyId },
    };
    if (query.userId) where.userId = query.userId;
    if (query.action) where.action = query.action;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }
    if (query.search) {
      const s = query.search;
      where.OR = [
        { action: { contains: s, mode: "insensitive" } },
        { description: { contains: s, mode: "insensitive" } },
      ];
    }
    return where;
  }
}

function toAuditLogResponse(r: RawAuditLog): AuditLogResponse {
  return {
    id: r.id,
    userId: r.userId,
    user: r.user ? { id: r.user.id, name: r.user.name } : null,
    branchId: r.branchId,
    branch: r.branch ? { id: r.branch.id, name: r.branch.name } : null,
    action: r.action,
    entity: r.entity,
    entityId: r.entityId,
    details: parseDetails(r.details),
    ipAddress: r.ipAddress,
    userAgent: r.userAgent,
    createdAt: r.createdAt.toISOString(),
  };
}

function toActivityLogResponse(r: RawActivityLog): ActivityLogResponse {
  return {
    id: r.id,
    userId: r.userId,
    user: r.user ? { id: r.user.id, name: r.user.name } : null,
    action: r.action,
    description: r.description,
    metadata: parseDetails(r.metadata),
    createdAt: r.createdAt.toISOString(),
  };
}

function parseDetails(value: string | null): unknown {
  if (value == null) return null;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

function serializeMetadata(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}
