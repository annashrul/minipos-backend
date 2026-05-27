import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  ActivityLogResponse,
  AuditLogResponse,
  AuditLogSummaryResponse,
  AuditSummaryQueryDto,
  CreateActivityLogDto,
  ListActivityLogsQueryDto,
  ListAuditLogsQueryDto,
} from "./dto/audit-logs.dto";
import type { PaginatedResponse } from "@/common/types/response";
import { paginate } from "@/common/utils/pagination";
import {
  AuditLogsRepository,
  type RawAuditLog,
  type RawActivityLog,
} from "./audit-logs.repository";

@Injectable()
export class AuditLogsService {
  constructor(private readonly repo: AuditLogsRepository) {}

  // ===========================
  // AuditLog
  // ===========================

  async listAuditLogs(
    companyId: string,
    query: ListAuditLogsQueryDto,
  ): Promise<PaginatedResponse<AuditLogResponse>> {
    const { page, perPage } = query;
    const where = this.buildAuditWhere(companyId, query);

    const [rows, total] = await Promise.all([
      this.repo.findManyAuditLogs(where, (page - 1) * perPage, perPage),
      this.repo.countAuditLogs(where),
    ]);

    return paginate(rows.map(toAuditLogResponse), total, page, perPage);
  }

  async findAuditLog(
    companyId: string,
    id: string,
  ): Promise<AuditLogResponse> {
    const row = await this.repo.findOneAuditLog({
      id,
      ...this.auditTenantWhere(companyId),
    });
    if (!row) throw new NotFoundException("Log audit tidak ditemukan");
    return toAuditLogResponse(row);
  }

  async findByEntity(
    companyId: string,
    entity: string,
    entityId: string,
  ): Promise<AuditLogResponse[]> {
    const rows = await this.repo.findAuditLogsByEntity({
      entity,
      entityId,
      ...this.auditTenantWhere(companyId),
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
      this.repo.countAuditLogs(where),
      this.repo.groupByAction(where),
      this.repo.groupByEntity(where),
      this.repo.groupByUser(where, 20),
    ]);

    const userIds = byUserRaw.map((u) => u.userId);
    const users = await this.repo.findUsersByIds(userIds);
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
  ): Promise<PaginatedResponse<ActivityLogResponse>> {
    const { page, perPage } = query;
    const where = this.buildActivityWhere(companyId, query);

    const [rows, total] = await Promise.all([
      this.repo.findManyActivityLogs(where, (page - 1) * perPage, perPage),
      this.repo.countActivityLogs(where),
    ]);

    return paginate(rows.map(toActivityLogResponse), total, page, perPage);
  }

  async findActivityLog(
    companyId: string,
    id: string,
  ): Promise<ActivityLogResponse> {
    const row = await this.repo.findOneActivityLog({
      id,
      user: { companyId },
    });
    if (!row) throw new NotFoundException("Log aktivitas tidak ditemukan");
    return toActivityLogResponse(row);
  }

  async createActivityLog(
    userId: string,
    dto: CreateActivityLogDto,
  ): Promise<ActivityLogResponse> {
    const metadata = serializeMetadata(dto.metadata);
    const created = await this.repo.createActivityLog({
      userId,
      action: dto.action,
      description: dto.description ?? null,
      metadata,
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
