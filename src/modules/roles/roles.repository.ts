import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export const ROLE_SELECT = {
  id: true,
  key: true,
  name: true,
  description: true,
  color: true,
  isSystem: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AppRoleSelect;

export type RawRole = Prisma.AppRoleGetPayload<{ select: typeof ROLE_SELECT }>;

@Injectable()
export class RolesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    where: Prisma.AppRoleWhereInput,
    skip: number,
    take: number,
  ): Promise<RawRole[]> {
    return this.prisma.appRole.findMany({
      where,
      select: ROLE_SELECT,
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      skip,
      take,
    });
  }

  async count(where: Prisma.AppRoleWhereInput): Promise<number> {
    return this.prisma.appRole.count({ where });
  }

  async findById(id: string): Promise<RawRole | null> {
    return this.prisma.appRole.findUnique({
      where: { id },
      select: ROLE_SELECT,
    });
  }

  async findMetaById(id: string) {
    return this.prisma.appRole.findUnique({
      where: { id },
      select: { id: true, key: true, isSystem: true },
    });
  }

  async countUsersForRoles(
    companyId: string,
    keys: string[],
  ): Promise<Map<string, number>> {
    if (keys.length === 0) return new Map();
    const grouped = await this.prisma.user.groupBy({
      by: ["role"],
      where: { role: { in: keys }, companyId, deletedAt: null },
      _count: { _all: true },
    });
    const map = new Map<string, number>();
    for (const g of grouped) {
      map.set(g.role, g._count._all);
    }
    return map;
  }

  async countUsersByRole(companyId: string, roleKey: string): Promise<number> {
    return this.prisma.user.count({
      where: { role: roleKey, companyId, deletedAt: null },
    });
  }

  async findMenusWithActions() {
    return this.prisma.appMenu.findMany({
      select: {
        id: true,
        actions: { select: { id: true } },
      },
    });
  }

  async findMenuPermissions(roleKey: string) {
    return this.prisma.roleMenuPermission.findMany({
      where: { role: roleKey },
      select: { menuId: true, allowed: true },
    });
  }

  async findActionPermissions(roleKey: string) {
    return this.prisma.roleActionPermission.findMany({
      where: { role: roleKey },
      select: { menuActionId: true, allowed: true },
    });
  }

  async findMenusByIds(ids: string[]) {
    return this.prisma.appMenu.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
  }

  async findActionsByIds(ids: string[]) {
    return this.prisma.menuAction.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
  }

  async listMenuTree() {
    return this.prisma.appMenu.findMany({
      orderBy: [{ group: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        key: true,
        name: true,
        path: true,
        group: true,
        sortOrder: true,
        isActive: true,
        actions: {
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: {
            id: true,
            key: true,
            name: true,
            sortOrder: true,
            isActive: true,
          },
        },
      },
    });
  }

  get tx() {
    return this.prisma;
  }
}
