import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  ListPlatformActivityLogsQueryDto,
  PlatformActivityLogListResponse,
  PlatformNotificationListResponse,
} from "@/contracts";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class PlatformNotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listActivityLogs(
    query: ListPlatformActivityLogsQueryDto,
  ): Promise<PlatformActivityLogListResponse> {
    const { page, perPage, search, action, entity } = query;
    const skip = (page - 1) * perPage;

    const where: Prisma.AuditLogWhereInput = {};
    if (search) {
      where.OR = [
        { entity: { contains: search, mode: "insensitive" } },
        { details: { contains: search, mode: "insensitive" } },
        { user: { name: { contains: search, mode: "insensitive" } } },
        {
          user: {
            company: { name: { contains: search, mode: "insensitive" } },
          },
        },
      ];
    }
    if (action && action !== "ALL") where.action = action;
    if (entity && entity !== "ALL") where.entity = entity;

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: {
              name: true,
              email: true,
              role: true,
              company: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: perPage,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      logs: logs.map((l) => ({
        id: l.id,
        action: l.action,
        entity: l.entity,
        entityId: l.entityId,
        details: l.details,
        userName: l.user?.name || "System",
        userEmail: l.user?.email || "",
        userRole: l.user?.role || "",
        companyName: l.user?.company?.name || "Platform",
        createdAt: l.createdAt.toISOString(),
      })),
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async listNotifications(): Promise<PlatformNotificationListResponse> {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [recentEvents, unreadCount] = await Promise.all([
      this.prisma.auditLog.findMany({
        where: {
          action: {
            in: [
              "LOGIN",
              "CREATE",
              "UPDATE_PLAN",
              "EXTEND_PLAN",
              "REVOKE_PLAN",
              "REGISTER",
            ],
          },
          entity: {
            in: [
              "Session",
              "Company",
              "Subscription",
              "User",
              "Transaction",
            ],
          },
          createdAt: { gte: oneDayAgo },
        },
        include: {
          user: {
            select: { name: true, company: { select: { name: true } } },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      this.prisma.auditLog.count({
        where: {
          action: {
            in: ["CREATE", "UPDATE_PLAN", "EXTEND_PLAN", "LOGIN"],
          },
          entity: { in: ["Company", "Subscription", "Session"] },
          createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
        },
      }),
    ]);

    return {
      notifications: recentEvents.map((e) => ({
        id: e.id,
        action: e.action,
        entity: e.entity,
        details: e.details,
        userName: e.user?.name || "System",
        companyName: e.user?.company?.name || "Platform",
        createdAt: e.createdAt.toISOString(),
      })),
      unreadCount,
    };
  }
}
