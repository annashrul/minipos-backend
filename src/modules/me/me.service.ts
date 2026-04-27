import { Injectable } from "@nestjs/common";
import type {
  AccessMenuDto,
  MeAccessMatrixResponse,
  MeMenusResponse,
} from "@/contracts";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class MeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the menu tree filtered to a single role's permissions.
   * Each menu/action in the result has `permissions: { [role]: boolean }`.
   * Also returns the role color for sidebar UI.
   */
  async getMenusForRole(role: string): Promise<MeMenusResponse> {
    const [menus, appRole] = await Promise.all([
      this.prisma.appMenu.findMany({
        where: { isActive: true },
        orderBy: [{ group: "asc" }, { sortOrder: "asc" }],
        include: {
          actions: {
            where: { isActive: true },
            orderBy: { sortOrder: "asc" },
            include: {
              roleActions: {
                where: { role },
                select: { allowed: true },
              },
            },
          },
          roleMenus: {
            where: { role },
            select: { allowed: true },
          },
        },
      }),
      this.prisma.appRole.findUnique({
        where: { key: role },
        select: { color: true },
      }),
    ]);

    const mapped: AccessMenuDto[] = menus.map((menu) => ({
      id: menu.id,
      key: menu.key,
      name: menu.name,
      path: menu.path,
      group: menu.group,
      sortOrder: menu.sortOrder,
      isActive: menu.isActive,
      permissions: { [role]: menu.roleMenus[0]?.allowed ?? false },
      actions: menu.actions.map((action) => ({
        id: action.id,
        key: action.key,
        name: action.name,
        sortOrder: action.sortOrder,
        isActive: action.isActive,
        permissions: { [role]: action.roleActions[0]?.allowed ?? false },
      })),
    }));

    return { role, menus: mapped, roleColor: appRole?.color ?? null };
  }

  /**
   * Returns the full access-control matrix: every active role x every menu.
   * Used by the access-control admin UI.
   */
  async getAccessMatrix(
    role: string,
    search?: string,
  ): Promise<MeAccessMatrixResponse> {
    const roles = await this.prisma.appRole.findMany({
      where: { isActive: true },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      select: { key: true },
    });
    const menus = await this.prisma.appMenu.findMany({
      where: {
        isActive: true,
        ...(search ? { name: { contains: search } } : {}),
      },
      orderBy: [{ group: "asc" }, { sortOrder: "asc" }],
      include: {
        roleMenus: true,
        actions: {
          where: { isActive: true },
          orderBy: { sortOrder: "asc" },
          include: {
            roleActions: true,
          },
        },
      },
    });

    const mapped: AccessMenuDto[] = menus.map((menu) => ({
      id: menu.id,
      key: menu.key,
      name: menu.name,
      path: menu.path,
      group: menu.group,
      sortOrder: menu.sortOrder,
      isActive: menu.isActive,
      permissions: Object.fromEntries(
        roles.map((r) => [
          r.key,
          menu.roleMenus.find((p) => p.role === r.key)?.allowed ?? false,
        ]),
      ),
      actions: menu.actions.map((action) => ({
        id: action.id,
        key: action.key,
        name: action.name,
        sortOrder: action.sortOrder,
        isActive: action.isActive,
        permissions: Object.fromEntries(
          roles.map((r) => [
            r.key,
            action.roleActions.find((p) => p.role === r.key)?.allowed ?? false,
          ]),
        ),
      })),
    }));

    return {
      role,
      roles: roles.map((r) => r.key),
      menus: mapped,
    };
  }

  /**
   * Returns the default landing route for the user's role:
   * "/dashboard" if dashboard menu is allowed, otherwise "/pos".
   */
  async getDefaultRouteForRole(role: string): Promise<string> {
    const dashboardPerm = await this.prisma.roleMenuPermission.findFirst({
      where: { role, menu: { key: "dashboard" }, allowed: true },
    });
    return dashboardPerm ? "/dashboard" : "/pos";
  }

  async getCompany(companyId: string): Promise<{
    id: string;
    name: string;
    slug: string;
    plan: string;
    planExpiresAt: string | null;
  }> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        slug: true,
        plan: true,
        planExpiresAt: true,
      },
    });
    return {
      id: company?.id ?? companyId,
      name: company?.name ?? "-",
      slug: company?.slug ?? "",
      plan: company?.plan ?? "FREE",
      planExpiresAt: company?.planExpiresAt?.toISOString() ?? null,
    };
  }

  async getCompanyWithUsage(companyId: string): Promise<{
    plan: string;
    planExpiresAt: string | null;
    productCount: number;
    userCount: number;
    branchCount: number;
  }> {
    const [company, productCount, userCount, branchCount] = await Promise.all([
      this.prisma.company.findUnique({
        where: { id: companyId },
        select: { plan: true, planExpiresAt: true },
      }),
      this.prisma.product.count({ where: { companyId } }),
      this.prisma.user.count({ where: { companyId } }),
      this.prisma.branch.count({ where: { companyId } }),
    ]);
    return {
      plan: company?.plan ?? "FREE",
      planExpiresAt: company?.planExpiresAt?.toISOString() ?? null,
      productCount,
      userCount,
      branchCount,
    };
  }
}
