import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/modules/prisma/prisma.service";

@Injectable()
export class MeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActiveMenusForRole(role: string) {
    return this.prisma.appMenu.findMany({
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
    });
  }

  async findRoleColor(role: string) {
    return this.prisma.appRole.findUnique({
      where: { key: role },
      select: { color: true },
    });
  }

  async findCompanyBusinessUnit(companyId: string) {
    return this.prisma.company.findUnique({
      where: { id: companyId },
      select: { businessUnit: true },
    });
  }

  async findActiveRoleKeys() {
    return this.prisma.appRole.findMany({
      where: { isActive: true },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
      select: { key: true },
    });
  }

  async findActiveMenusWithAllPermissions(search?: string) {
    return this.prisma.appMenu.findMany({
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
  }

  async findDashboardPermission(role: string) {
    return this.prisma.roleMenuPermission.findFirst({
      where: { role, menu: { key: "dashboard" }, allowed: true },
    });
  }

  async findCompanyById(companyId: string) {
    return this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        name: true,
        slug: true,
        plan: true,
        planExpiresAt: true,
        businessUnit: true,
      },
    });
  }

  async updateCompanyBusinessUnit(
    companyId: string,
    businessUnit: string,
  ) {
    return this.prisma.company.update({
      where: { id: companyId },
      data: { businessUnit },
      select: { id: true, name: true, businessUnit: true },
    });
  }

  async findCompanyPlan(companyId: string) {
    return this.prisma.company.findUnique({
      where: { id: companyId },
      select: { plan: true, planExpiresAt: true },
    });
  }

  async countProducts(companyId: string) {
    return this.prisma.product.count({ where: { companyId } });
  }

  async countUsers(companyId: string) {
    return this.prisma.user.count({ where: { companyId } });
  }

  async countBranches(companyId: string) {
    return this.prisma.branch.count({ where: { companyId } });
  }
}
