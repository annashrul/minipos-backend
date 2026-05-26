import { Injectable } from "@nestjs/common";
import type {
  AccessMenuDto,
  MeAccessMatrixResponse,
  MeMenusResponse,
} from "./dto/me.dto";
import { MeRepository } from "./me.repository";

@Injectable()
export class MeService {
  constructor(private readonly repo: MeRepository) {}

  /**
   * Returns the menu tree filtered to a single role's permissions.
   * Each menu/action in the result has `permissions: { [role]: boolean }`.
   * Also returns the role color for sidebar UI.
   *
   * Kalau `companyId` provided, menu akan di-filter berdasarkan
   * `Company.businessUnit`. Menu dengan `businessUnits` non-null yang tidak
   * include businessUnit company saat ini akan di-drop. PLATFORM_OWNER
   * (companyId null) tidak di-filter.
   */
  async getMenusForRole(
    role: string,
    companyId?: string | null,
  ): Promise<MeMenusResponse> {
    const [menus, appRole, company] = await Promise.all([
      this.repo.findActiveMenusForRole(role),
      this.repo.findRoleColor(role),
      companyId
        ? this.repo.findCompanyBusinessUnit(companyId)
        : Promise.resolve(null),
    ]);

    const businessUnit = company?.businessUnit ?? null;
    const isPlatformOwner = !companyId;

    const filtered = menus.filter((menu) => {
      if (isPlatformOwner) return true;
      const units = menu.businessUnits as string[] | null | undefined;
      if (!units || units.length === 0) return true;
      return businessUnit ? units.includes(businessUnit) : true;
    });

    const mapped: AccessMenuDto[] = filtered.map((menu) => ({
      id: menu.id,
      key: menu.key,
      name: menu.name,
      path: menu.path,
      group: menu.group,
      subgroup: menu.subgroup ?? null,
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
    const roles = await this.repo.findActiveRoleKeys();
    const menus = await this.repo.findActiveMenusWithAllPermissions(search);

    const mapped: AccessMenuDto[] = menus.map((menu) => ({
      id: menu.id,
      key: menu.key,
      name: menu.name,
      path: menu.path,
      group: menu.group,
      subgroup: menu.subgroup ?? null,
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
    const dashboardPerm = await this.repo.findDashboardPermission(role);
    return dashboardPerm ? "/dashboard" : "/pos";
  }

  async getCompany(companyId: string): Promise<{
    id: string;
    name: string;
    slug: string;
    plan: string;
    planExpiresAt: string | null;
    businessUnit: string;
  }> {
    const company = await this.repo.findCompanyById(companyId);
    return {
      id: company?.id ?? companyId,
      name: company?.name ?? "-",
      slug: company?.slug ?? "",
      plan: company?.plan ?? "FREE",
      planExpiresAt: company?.planExpiresAt?.toISOString() ?? null,
      businessUnit: company?.businessUnit ?? "RETAIL",
    };
  }

  async updateCompanyBusinessUnit(
    companyId: string,
    businessUnit: "RETAIL" | "BENGKEL" | "RESTAURANT" | "CAFE",
  ) {
    const updated = await this.repo.updateCompanyBusinessUnit(
      companyId,
      businessUnit,
    );
    return {
      id: updated.id,
      name: updated.name,
      businessUnit: updated.businessUnit,
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
      this.repo.findCompanyPlan(companyId),
      this.repo.countProducts(companyId),
      this.repo.countUsers(companyId),
      this.repo.countBranches(companyId),
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
