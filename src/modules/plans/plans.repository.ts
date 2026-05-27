import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const MENU_ACCESS_SELECT = {
  id: true,
  plan: true,
  menuKey: true,
  allowed: true,
} satisfies Prisma.PlanMenuAccessSelect;

export type RawPlanMenuAccess = Prisma.PlanMenuAccessGetPayload<{
  select: typeof MENU_ACCESS_SELECT;
}>;

export const ACTION_ACCESS_SELECT = {
  id: true,
  plan: true,
  menuKey: true,
  actionKey: true,
  allowed: true,
} satisfies Prisma.PlanActionAccessSelect;

export type RawPlanActionAccess = Prisma.PlanActionAccessGetPayload<{
  select: typeof ACTION_ACCESS_SELECT;
}>;

@Injectable()
export class PlansRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Menu Access ─────────────────────────────────────────────
  async findManyMenuAccess(
    where: Prisma.PlanMenuAccessWhereInput,
    orderBy: Prisma.PlanMenuAccessOrderByWithRelationInput[],
  ): Promise<RawPlanMenuAccess[]> {
    return this.prisma.planMenuAccess.findMany({
      where,
      select: MENU_ACCESS_SELECT,
      orderBy,
    });
  }

  async findUniqueMenuAccess(
    where: Prisma.PlanMenuAccessWhereUniqueInput,
  ): Promise<RawPlanMenuAccess | null> {
    return this.prisma.planMenuAccess.findUnique({
      where,
      select: MENU_ACCESS_SELECT,
    });
  }

  async updateMenuAccess(
    id: string,
    data: Prisma.PlanMenuAccessUpdateInput,
  ): Promise<RawPlanMenuAccess> {
    return this.prisma.planMenuAccess.update({
      where: { id },
      data,
      select: MENU_ACCESS_SELECT,
    });
  }

  // ── Action Access ───────────────────────────────────────────
  async findManyActionAccess(
    where: Prisma.PlanActionAccessWhereInput,
    orderBy: Prisma.PlanActionAccessOrderByWithRelationInput[],
  ): Promise<RawPlanActionAccess[]> {
    return this.prisma.planActionAccess.findMany({
      where,
      select: ACTION_ACCESS_SELECT,
      orderBy,
    });
  }

  async findUniqueActionAccess(
    where: Prisma.PlanActionAccessWhereUniqueInput,
  ): Promise<RawPlanActionAccess | null> {
    return this.prisma.planActionAccess.findUnique({
      where,
      select: ACTION_ACCESS_SELECT,
    });
  }

  async updateActionAccess(
    id: string,
    data: Prisma.PlanActionAccessUpdateInput,
  ): Promise<RawPlanActionAccess> {
    return this.prisma.planActionAccess.update({
      where: { id },
      data,
      select: ACTION_ACCESS_SELECT,
    });
  }

  // ── App Menu ────────────────────────────────────────────────
  async findAppMenusByKeys(keys: string[]): Promise<{ key: string }[]> {
    return this.prisma.appMenu.findMany({
      where: { key: { in: keys } },
      select: { key: true },
    });
  }

  async findAppMenusWithActions(
    keys: string[],
  ): Promise<{ key: string; actions: { key: string }[] }[]> {
    return this.prisma.appMenu.findMany({
      where: { key: { in: keys } },
      select: {
        key: true,
        actions: { select: { key: true } },
      },
    });
  }

  async findAllMenusForComparison(): Promise<
    {
      id: string;
      key: string;
      name: string;
      group: string;
      actions: { id: string; key: string; name: string }[];
    }[]
  > {
    return this.prisma.appMenu.findMany({
      orderBy: [{ group: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        key: true,
        name: true,
        group: true,
        actions: {
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: {
            id: true,
            key: true,
            name: true,
          },
        },
      },
    });
  }

  async findAllMenuAccessRaw(): Promise<
    { menuKey: string; plan: string; allowed: boolean }[]
  > {
    return this.prisma.planMenuAccess.findMany();
  }

  async findAllActionAccessRaw(): Promise<
    { menuKey: string; actionKey: string; plan: string; allowed: boolean }[]
  > {
    return this.prisma.planActionAccess.findMany();
  }

  // ── Check helpers ───────────────────────────────────────────
  async findMenuAccessAllowed(
    plan: string,
    menuKey: string,
  ): Promise<{ allowed: boolean } | null> {
    return this.prisma.planMenuAccess.findUnique({
      where: { plan_menuKey: { plan, menuKey } },
      select: { allowed: true },
    });
  }

  async findActionAccessAllowed(
    plan: string,
    menuKey: string,
    actionKey: string,
  ): Promise<{ allowed: boolean } | null> {
    return this.prisma.planActionAccess.findUnique({
      where: {
        plan_menuKey_actionKey: { plan, menuKey, actionKey },
      },
      select: { allowed: true },
    });
  }
}
