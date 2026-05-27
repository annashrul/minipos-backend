import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  ListPlanAccessQueryDto,
  PlanActionAccessListResponse,
  PlanActionAccessResponse,
  PlanCheckQueryDto,
  PlanCheckResponse,
  PlanComparisonResponse,
  PlanMenuAccessListResponse,
  PlanMenuAccessResponse,
  PlanTierDto,
  SetPlanActionAccessDto,
  SetPlanMenuAccessDto,
  UpdatePlanAccessDto,
} from "./dto/plans.dto";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { EVENTS, RealtimeService } from "@/modules/realtime/realtime.service";
import {
  PlansRepository,
  type RawPlanMenuAccess,
  type RawPlanActionAccess,
} from "./plans.repository";

const PLAN_TIERS: PlanTierDto[] = ["FREE", "PRO", "ENTERPRISE"];

@Injectable()
export class PlansService {
  constructor(
    private readonly repo: PlansRepository,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async listMenuAccess(
    query: ListPlanAccessQueryDto,
  ): Promise<PlanMenuAccessListResponse> {
    const rows = await this.repo.findManyMenuAccess(
      query.plan ? { plan: query.plan } : {},
      [{ plan: "asc" }, { menuKey: "asc" }],
    );
    return { items: rows.map(toMenuAccessResponse) };
  }

  async setMenuAccess(
    dto: SetPlanMenuAccessDto,
  ): Promise<PlanMenuAccessListResponse> {
    if (dto.items.length > 0) {
      const keys = Array.from(new Set(dto.items.map((i) => i.menuKey)));
      const found = await this.repo.findAppMenusByKeys(keys);
      if (found.length !== keys.length) {
        throw new NotFoundException("Sebagian menuKey tidak ditemukan");
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.planMenuAccess.deleteMany({ where: { plan: dto.plan } });
      if (dto.items.length > 0) {
        await tx.planMenuAccess.createMany({
          data: dto.items.map((i) => ({
            plan: dto.plan,
            menuKey: i.menuKey,
            allowed: i.allowed,
          })),
          skipDuplicates: true,
        });
      }
    });

    const rows = await this.repo.findManyMenuAccess(
      { plan: dto.plan },
      [{ menuKey: "asc" }],
    );
    this.realtime.emit(EVENTS.PLAN_ACCESS_UPDATED, { plan: dto.plan });
    return { items: rows.map(toMenuAccessResponse) };
  }

  async updateMenuAccess(
    id: string,
    dto: UpdatePlanAccessDto,
  ): Promise<PlanMenuAccessResponse> {
    const existing = await this.repo.findUniqueMenuAccess({ id });
    if (!existing) {
      throw new NotFoundException("Plan menu access tidak ditemukan");
    }

    const updated = await this.repo.updateMenuAccess(id, {
      allowed: dto.allowed,
    });
    this.realtime.emit(EVENTS.PLAN_ACCESS_UPDATED, { plan: updated.plan });
    return toMenuAccessResponse(updated);
  }

  async listActionAccess(
    query: ListPlanAccessQueryDto,
  ): Promise<PlanActionAccessListResponse> {
    const rows = await this.repo.findManyActionAccess(
      query.plan ? { plan: query.plan } : {},
      [{ plan: "asc" }, { menuKey: "asc" }, { actionKey: "asc" }],
    );
    return { items: rows.map(toActionAccessResponse) };
  }

  async setActionAccess(
    dto: SetPlanActionAccessDto,
  ): Promise<PlanActionAccessListResponse> {
    if (dto.items.length > 0) {
      const menuKeys = Array.from(new Set(dto.items.map((i) => i.menuKey)));
      const menus = await this.repo.findAppMenusWithActions(menuKeys);
      if (menus.length !== menuKeys.length) {
        throw new NotFoundException("Sebagian menuKey tidak ditemukan");
      }
      const validPairs = new Set<string>();
      for (const m of menus) {
        for (const a of m.actions) {
          validPairs.add(`${m.key}::${a.key}`);
        }
      }
      for (const item of dto.items) {
        if (!validPairs.has(`${item.menuKey}::${item.actionKey}`)) {
          throw new BadRequestException(
            `Action ${item.actionKey} tidak ada pada menu ${item.menuKey}`,
          );
        }
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.planActionAccess.deleteMany({ where: { plan: dto.plan } });
      if (dto.items.length > 0) {
        await tx.planActionAccess.createMany({
          data: dto.items.map((i) => ({
            plan: dto.plan,
            menuKey: i.menuKey,
            actionKey: i.actionKey,
            allowed: i.allowed,
          })),
          skipDuplicates: true,
        });
      }
    });

    const rows = await this.repo.findManyActionAccess(
      { plan: dto.plan },
      [{ menuKey: "asc" }, { actionKey: "asc" }],
    );
    this.realtime.emit(EVENTS.PLAN_ACCESS_UPDATED, { plan: dto.plan });
    return { items: rows.map(toActionAccessResponse) };
  }

  async updateActionAccess(
    id: string,
    dto: UpdatePlanAccessDto,
  ): Promise<PlanActionAccessResponse> {
    const existing = await this.repo.findUniqueActionAccess({ id });
    if (!existing) {
      throw new NotFoundException("Plan action access tidak ditemukan");
    }

    const updated = await this.repo.updateActionAccess(id, {
      allowed: dto.allowed,
    });
    this.realtime.emit(EVENTS.PLAN_ACCESS_UPDATED, { plan: updated.plan });
    return toActionAccessResponse(updated);
  }

  async check(query: PlanCheckQueryDto): Promise<PlanCheckResponse> {
    const { plan, menuKey, actionKey } = query;

    if (actionKey) {
      if (!menuKey) {
        throw new BadRequestException(
          "menuKey wajib diisi jika actionKey diberikan",
        );
      }
      const row = await this.repo.findActionAccessAllowed(
        plan,
        menuKey,
        actionKey,
      );
      return { allowed: row?.allowed ?? false };
    }

    if (menuKey) {
      const row = await this.repo.findMenuAccessAllowed(plan, menuKey);
      return { allowed: row?.allowed ?? false };
    }

    return { allowed: false };
  }

  async comparison(): Promise<PlanComparisonResponse> {
    const [menus, menuAccess, actionAccess] = await Promise.all([
      this.repo.findAllMenusForComparison(),
      this.repo.findAllMenuAccessRaw(),
      this.repo.findAllActionAccessRaw(),
    ]);

    const menuMap = new Map<string, Map<string, boolean>>();
    for (const a of menuAccess) {
      let inner = menuMap.get(a.menuKey);
      if (!inner) {
        inner = new Map();
        menuMap.set(a.menuKey, inner);
      }
      inner.set(a.plan, a.allowed);
    }

    const actionMap = new Map<string, Map<string, boolean>>();
    for (const a of actionAccess) {
      const k = `${a.menuKey}::${a.actionKey}`;
      let inner = actionMap.get(k);
      if (!inner) {
        inner = new Map();
        actionMap.set(k, inner);
      }
      inner.set(a.plan, a.allowed);
    }

    const menuRows = menus.map((m) => {
      const inner = menuMap.get(m.key);
      return {
        menuId: m.id,
        key: m.key,
        name: m.name,
        group: m.group,
        byPlan: byPlanFromMap(inner),
      };
    });

    const actionRows = menus.flatMap((m) =>
      m.actions.map((a) => {
        const inner = actionMap.get(`${m.key}::${a.key}`);
        return {
          menuActionId: a.id,
          menuKey: m.key,
          actionKey: a.key,
          name: a.name,
          byPlan: byPlanFromMap(inner),
        };
      }),
    );

    return { menus: menuRows, actions: actionRows };
  }
}

function byPlanFromMap(map: Map<string, boolean> | undefined): {
  FREE: boolean;
  PRO: boolean;
  ENTERPRISE: boolean;
} {
  return {
    FREE: map?.get("FREE") ?? false,
    PRO: map?.get("PRO") ?? false,
    ENTERPRISE: map?.get("ENTERPRISE") ?? false,
  };
}

function toMenuAccessResponse(r: RawPlanMenuAccess): PlanMenuAccessResponse {
  return {
    id: r.id,
    plan: r.plan,
    menuKey: r.menuKey,
    allowed: r.allowed,
  };
}

function toActionAccessResponse(
  r: RawPlanActionAccess,
): PlanActionAccessResponse {
  return {
    id: r.id,
    plan: r.plan,
    menuKey: r.menuKey,
    actionKey: r.actionKey,
    allowed: r.allowed,
  };
}

// Silence unused-tier warning while keeping the canonical list available.
void PLAN_TIERS;
