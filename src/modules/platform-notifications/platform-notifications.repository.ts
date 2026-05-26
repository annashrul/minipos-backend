import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const AUDIT_LOG_SELECT = {
  id: true,
  action: true,
  entity: true,
  entityId: true,
  details: true,
  createdAt: true,
  user: {
    select: {
      name: true,
      email: true,
      role: true,
      company: { select: { name: true } },
    },
  },
} satisfies Prisma.AuditLogSelect;

export type RawAuditLog = Prisma.AuditLogGetPayload<{
  select: typeof AUDIT_LOG_SELECT;
}>;

export const NOTIFICATION_LOG_SELECT = {
  id: true,
  action: true,
  entity: true,
  details: true,
  createdAt: true,
  user: {
    select: {
      name: true,
      company: { select: { name: true } },
    },
  },
} satisfies Prisma.AuditLogSelect;

export type RawNotificationLog = Prisma.AuditLogGetPayload<{
  select: typeof NOTIFICATION_LOG_SELECT;
}>;

@Injectable()
export class PlatformNotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findManyActivityLogs(
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

  async countActivityLogs(
    where: Prisma.AuditLogWhereInput,
  ): Promise<number> {
    return this.prisma.auditLog.count({ where });
  }

  async findRecentNotifications(
    where: Prisma.AuditLogWhereInput,
    take: number,
  ): Promise<RawNotificationLog[]> {
    return this.prisma.auditLog.findMany({
      where,
      select: NOTIFICATION_LOG_SELECT,
      orderBy: { createdAt: "desc" },
      take,
    });
  }

  async countUnread(
    where: Prisma.AuditLogWhereInput,
  ): Promise<number> {
    return this.prisma.auditLog.count({ where });
  }
}
