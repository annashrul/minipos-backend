import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateRoleDto,
  ListRolesQueryDto,
  MenuTreeResponse,
  RoleDetailResponse,
  RoleListResponse,
  RoleResponse,
  ToggleRoleActionPermissionDto,
  ToggleRoleMenuPermissionDto,
  UpdateRoleDto,
} from "@/contracts";
import { PrismaService } from "../prisma/prisma.service";

const ROLE_SELECT = {
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

type RawRole = Prisma.AppRoleGetPayload<{ select: typeof ROLE_SELECT }>;

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    companyId: string,
    query: ListRolesQueryDto,
  ): Promise<RoleListResponse> {
    const { search, page, perPage } = query;
    const where: Prisma.AppRoleWhereInput = {};
    if (search) where.name = { contains: search, mode: "insensitive" };

    const [rows, total] = await Promise.all([
      this.prisma.appRole.findMany({
        where,
        select: ROLE_SELECT,
        orderBy: [{ isSystem: "desc" }, { name: "asc" }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.appRole.count({ where }),
    ]);

    const userCounts = await this.countUsersForRoles(
      companyId,
      rows.map((r) => r.key),
    );

    return {
      roles: rows.map((r) => toRoleResponse(r, userCounts.get(r.key) ?? 0)),
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<RoleDetailResponse> {
    const role = await this.prisma.appRole.findUnique({
      where: { id },
      select: ROLE_SELECT,
    });
    if (!role) throw new NotFoundException("Role tidak ditemukan");

    const [menus, menuPerms, actionPerms, userCount] = await Promise.all([
      this.prisma.appMenu.findMany({
        select: {
          id: true,
          actions: { select: { id: true } },
        },
      }),
      this.prisma.roleMenuPermission.findMany({
        where: { role: role.key },
        select: { menuId: true, allowed: true },
      }),
      this.prisma.roleActionPermission.findMany({
        where: { role: role.key },
        select: { menuActionId: true, allowed: true },
      }),
      this.prisma.user.count({
        where: { role: role.key, companyId, deletedAt: null },
      }),
    ]);

    const menuPermMap = new Map(
      menuPerms.map((p) => [p.menuId, p.allowed]),
    );
    const actionPermMap = new Map(
      actionPerms.map((p) => [p.menuActionId, p.allowed]),
    );

    const menuPermissions = menus.map((m) => ({
      menuId: m.id,
      canView: menuPermMap.get(m.id) ?? false,
    }));
    const actionPermissions = menus
      .flatMap((m) => m.actions)
      .map((a) => ({
        menuActionId: a.id,
        allowed: actionPermMap.get(a.id) ?? false,
      }));

    return {
      ...toRoleResponse(role, userCount),
      menuPermissions,
      actionPermissions,
    };
  }

  async create(
    _companyId: string,
    dto: CreateRoleDto,
  ): Promise<RoleDetailResponse> {
    const key = generateRoleKey(dto.name);
    if (!key) {
      throw new BadRequestException("Nama role tidak valid untuk membuat key");
    }

    await this.assertReferences(dto.menuPermissions, dto.actionPermissions);

    try {
      const role = await this.prisma.$transaction(async (tx) => {
        const created = await tx.appRole.create({
          data: {
            key,
            name: dto.name,
            description: dto.description ?? null,
            color: dto.color ?? null,
            isSystem: false,
          },
          select: ROLE_SELECT,
        });

        if (dto.menuPermissions.length > 0) {
          await tx.roleMenuPermission.createMany({
            data: dto.menuPermissions.map((p) => ({
              role: created.key,
              menuId: p.menuId,
              allowed: p.canView,
            })),
            skipDuplicates: true,
          });
        }

        if (dto.actionPermissions.length > 0) {
          await tx.roleActionPermission.createMany({
            data: dto.actionPermissions.map((p) => ({
              role: created.key,
              menuActionId: p.menuActionId,
              allowed: p.allowed,
            })),
            skipDuplicates: true,
          });
        }

        return created;
      });

      return this.findById(_companyId, role.id);
    } catch (err) {
      throwOnDup(err);
      throw err;
    }
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateRoleDto,
  ): Promise<RoleDetailResponse> {
    const existing = await this.prisma.appRole.findUnique({
      where: { id },
      select: { id: true, key: true, isSystem: true },
    });
    if (!existing) throw new NotFoundException("Role tidak ditemukan");
    if (existing.isSystem) {
      throw new BadRequestException("Role sistem tidak bisa diubah");
    }

    if (dto.menuPermissions || dto.actionPermissions) {
      await this.assertReferences(
        dto.menuPermissions ?? [],
        dto.actionPermissions ?? [],
      );
    }

    const data: Prisma.AppRoleUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined)
      data.description = dto.description ?? null;
    if (dto.color !== undefined) data.color = dto.color ?? null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    try {
      await this.prisma.$transaction(async (tx) => {
        if (Object.keys(data).length > 0) {
          await tx.appRole.update({ where: { id }, data });
        }

        if (dto.menuPermissions) {
          await tx.roleMenuPermission.deleteMany({
            where: { role: existing.key },
          });
          if (dto.menuPermissions.length > 0) {
            await tx.roleMenuPermission.createMany({
              data: dto.menuPermissions.map((p) => ({
                role: existing.key,
                menuId: p.menuId,
                allowed: p.canView,
              })),
              skipDuplicates: true,
            });
          }
        }

        if (dto.actionPermissions) {
          await tx.roleActionPermission.deleteMany({
            where: { role: existing.key },
          });
          if (dto.actionPermissions.length > 0) {
            await tx.roleActionPermission.createMany({
              data: dto.actionPermissions.map((p) => ({
                role: existing.key,
                menuActionId: p.menuActionId,
                allowed: p.allowed,
              })),
              skipDuplicates: true,
            });
          }
        }
      });

      return this.findById(companyId, id);
    } catch (err) {
      throwOnDup(err);
      throw err;
    }
  }

  async delete(_companyId: string, id: string): Promise<{ success: true }> {
    const existing = await this.prisma.appRole.findUnique({
      where: { id },
      select: { id: true, key: true, isSystem: true },
    });
    if (!existing) throw new NotFoundException("Role tidak ditemukan");
    if (existing.isSystem) {
      throw new BadRequestException("Role sistem tidak bisa dihapus");
    }

    const userCount = await this.prisma.user.count({
      where: { role: existing.key, deletedAt: null },
    });
    if (userCount > 0) {
      throw new BadRequestException(`Role masih dipakai ${userCount} user`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.roleMenuPermission.deleteMany({
        where: { role: existing.key },
      });
      await tx.roleActionPermission.deleteMany({
        where: { role: existing.key },
      });
      await tx.appRole.delete({ where: { id } });
    });

    return { success: true };
  }

  async setMenuPermission(
    dto: ToggleRoleMenuPermissionDto,
  ): Promise<{ success: true }> {
    await this.prisma.roleMenuPermission.upsert({
      where: {
        role_menuId: { role: dto.role, menuId: dto.menuId },
      },
      update: { allowed: dto.allowed },
      create: {
        role: dto.role,
        menuId: dto.menuId,
        allowed: dto.allowed,
      },
    });
    return { success: true };
  }

  async setActionPermission(
    dto: ToggleRoleActionPermissionDto,
  ): Promise<{ success: true }> {
    await this.prisma.roleActionPermission.upsert({
      where: {
        role_menuActionId: {
          role: dto.role,
          menuActionId: dto.menuActionId,
        },
      },
      update: { allowed: dto.allowed },
      create: {
        role: dto.role,
        menuActionId: dto.menuActionId,
        allowed: dto.allowed,
      },
    });
    return { success: true };
  }

  async listMenus(): Promise<MenuTreeResponse> {
    const menus = await this.prisma.appMenu.findMany({
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

    return {
      menus: menus.map((m) => ({
        id: m.id,
        key: m.key,
        name: m.name,
        path: m.path,
        group: m.group,
        sortOrder: m.sortOrder,
        isActive: m.isActive,
        actions: m.actions.map((a) => ({
          id: a.id,
          key: a.key,
          name: a.name,
          sortOrder: a.sortOrder,
          isActive: a.isActive,
        })),
      })),
    };
  }

  private async countUsersForRoles(
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

  private async assertReferences(
    menuPerms: { menuId: string }[],
    actionPerms: { menuActionId: string }[],
  ) {
    const menuIds = Array.from(new Set(menuPerms.map((p) => p.menuId)));
    const actionIds = Array.from(
      new Set(actionPerms.map((p) => p.menuActionId)),
    );

    if (menuIds.length > 0) {
      const found = await this.prisma.appMenu.findMany({
        where: { id: { in: menuIds } },
        select: { id: true },
      });
      if (found.length !== menuIds.length) {
        throw new NotFoundException("Sebagian menu tidak ditemukan");
      }
    }

    if (actionIds.length > 0) {
      const found = await this.prisma.menuAction.findMany({
        where: { id: { in: actionIds } },
        select: { id: true },
      });
      if (found.length !== actionIds.length) {
        throw new NotFoundException("Sebagian action menu tidak ditemukan");
      }
    }
  }
}

function toRoleResponse(r: RawRole, userCount: number): RoleResponse {
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    color: r.color,
    isSystem: r.isSystem,
    isActive: r.isActive,
    userCount,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function generateRoleKey(name: string): string {
  return name
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/[^A-Z0-9_]/g, "");
}

function throwOnDup(err: unknown): void {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    throw new ConflictException("Nama atau key role sudah digunakan");
  }
}
