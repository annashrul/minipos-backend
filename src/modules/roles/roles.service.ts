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
} from "./dto/roles.dto";
import { RolesRepository, type RawRole } from "./roles.repository";
import { EVENTS, RealtimeService } from "../realtime/realtime.service";

@Injectable()
export class RolesService {
  constructor(
    private readonly repo: RolesRepository,
    private readonly realtime: RealtimeService,
  ) {}

  async list(
    companyId: string,
    query: ListRolesQueryDto,
  ): Promise<RoleListResponse> {
    const { search, page, perPage } = query;
    const where: Prisma.AppRoleWhereInput = {};
    if (search) where.name = { contains: search, mode: "insensitive" };

    const [rows, total] = await Promise.all([
      this.repo.findMany(where, (page - 1) * perPage, perPage),
      this.repo.count(where),
    ]);

    const userCounts = await this.repo.countUsersForRoles(
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
    const role = await this.repo.findById(id);
    if (!role) throw new NotFoundException("Role tidak ditemukan");

    const [menus, menuPerms, actionPerms, userCount] = await Promise.all([
      this.repo.findMenusWithActions(),
      this.repo.findMenuPermissions(role.key),
      this.repo.findActionPermissions(role.key),
      this.repo.countUsersByRole(companyId, role.key),
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
    companyId: string,
    dto: CreateRoleDto,
  ): Promise<RoleDetailResponse> {
    const key = generateRoleKey(dto.name);
    if (!key) {
      throw new BadRequestException("Nama role tidak valid untuk membuat key");
    }

    await this.assertReferences(dto.menuPermissions, dto.actionPermissions);

    try {
      const role = await this.repo.tx.$transaction(async (tx) => {
        const created = await tx.appRole.create({
          data: {
            key,
            name: dto.name,
            description: dto.description ?? null,
            color: dto.color ?? null,
            isSystem: false,
          },
          select: { id: true, key: true },
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

      this.realtime.emit(EVENTS.MENU_ACCESS_UPDATED, { role: role.key });
      return this.findById(companyId, role.id);
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
    const existing = await this.repo.findMetaById(id);
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
      await this.repo.tx.$transaction(async (tx) => {
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

      if (dto.menuPermissions || dto.actionPermissions) {
        this.realtime.emit(EVENTS.MENU_ACCESS_UPDATED, { role: existing.key });
      }
      return this.findById(companyId, id);
    } catch (err) {
      throwOnDup(err);
      throw err;
    }
  }

  async delete(_companyId: string, id: string): Promise<{ success: true }> {
    const existing = await this.repo.findMetaById(id);
    if (!existing) throw new NotFoundException("Role tidak ditemukan");
    if (existing.isSystem) {
      throw new BadRequestException("Role sistem tidak bisa dihapus");
    }

    const userCount = await this.repo.countUsersByRole(_companyId, existing.key);
    if (userCount > 0) {
      throw new BadRequestException(`Role masih dipakai ${userCount} user`);
    }

    await this.repo.tx.$transaction(async (tx) => {
      await tx.roleMenuPermission.deleteMany({
        where: { role: existing.key },
      });
      await tx.roleActionPermission.deleteMany({
        where: { role: existing.key },
      });
      await tx.appRole.delete({ where: { id } });
    });

    this.realtime.emit(EVENTS.MENU_ACCESS_UPDATED, { role: existing.key });
    return { success: true };
  }

  async setMenuPermission(
    dto: ToggleRoleMenuPermissionDto,
  ): Promise<{ success: true }> {
    await this.repo.tx.roleMenuPermission.upsert({
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
    this.realtime.emit(EVENTS.MENU_ACCESS_UPDATED, { role: dto.role });
    return { success: true };
  }

  async setActionPermission(
    dto: ToggleRoleActionPermissionDto,
  ): Promise<{ success: true }> {
    await this.repo.tx.roleActionPermission.upsert({
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
    this.realtime.emit(EVENTS.MENU_ACCESS_UPDATED, { role: dto.role });
    return { success: true };
  }

  async listMenus(): Promise<MenuTreeResponse> {
    const menus = await this.repo.listMenuTree();

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

  private async assertReferences(
    menuPerms: { menuId: string }[],
    actionPerms: { menuActionId: string }[],
  ) {
    const menuIds = Array.from(new Set(menuPerms.map((p) => p.menuId)));
    const actionIds = Array.from(
      new Set(actionPerms.map((p) => p.menuActionId)),
    );

    if (menuIds.length > 0) {
      const found = await this.repo.findMenusByIds(menuIds);
      if (found.length !== menuIds.length) {
        throw new NotFoundException("Sebagian menu tidak ditemukan");
      }
    }

    if (actionIds.length > 0) {
      const found = await this.repo.findActionsByIds(actionIds);
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
