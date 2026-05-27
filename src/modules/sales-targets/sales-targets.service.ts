import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { toDateOnly } from "@/common/utils/date";
import { throwIfUniqueConstraint } from "@/common/utils/prisma-errors";
import type {
  CreateSalesTargetDto,
  EvaluateBadgesDto,
  EvaluateBadgesResponse,
  GetSalesBadgesQueryDto,
  LeaderboardEntryDto,
  LeaderboardQueryDto,
  LeaderboardResponse,
  ListSalesTargetsQueryDto,
  SalesBadgeResponse,
  SalesTargetListResponse,
  SalesTargetResponse,
  SalesTargetStatusDto,
  SalesTargetTypeDto,
  UpdateSalesTargetDto,
} from "./dto/sales-targets.dto";
import {
  SalesTargetsRepository,
  type RawSalesTarget,
} from "./sales-targets.repository";
import { PrismaService } from "@/modules/prisma/prisma.service";

// Definisi badge (port dari apps/web/src/server/actions/sales-targets-types.ts).
// Hanya butuh title + description untuk auto-award; icon/color cukup di FE.
const BADGE_DEFINITIONS: { key: string; title: string; description: string }[] =
  [
    {
      key: "TOP_SELLER",
      title: "Top Seller",
      description: "Pendapatan tertinggi dalam periode",
    },
    {
      key: "ZERO_VOID",
      title: "Zero Void",
      description: "Tidak ada transaksi void dalam periode",
    },
    {
      key: "TARGET_CRUSHER",
      title: "Target Crusher",
      description: "Melampaui target 120%+",
    },
    {
      key: "STREAK_7",
      title: "7-Day Streak",
      description: "Mencapai target 7 hari berturut-turut",
    },
    {
      key: "SPEED_DEMON",
      title: "Speed Demon",
      description: "Transaksi terbanyak dalam periode",
    },
    {
      key: "EARLY_BIRD",
      title: "Early Bird",
      description: "Transaksi terbanyak sebelum jam 10 pagi",
    },
    {
      key: "NIGHT_OWL",
      title: "Night Owl",
      description: "Transaksi terbanyak setelah jam 8 malam",
    },
    {
      key: "TEAM_PLAYER",
      title: "Team Player",
      description: "Membantu banyak cabang (multi-branch)",
    },
  ];

@Injectable()
export class SalesTargetsService {
  constructor(
    private readonly repo: SalesTargetsRepository,
    private readonly prisma: PrismaService,
  ) {}

  // Filter scoped to company through user/branch relations (no companyId column).
  private tenantWhere(companyId: string): Prisma.SalesTargetWhereInput {
    return {
      OR: [
        { user: { is: { companyId } } },
        { userId: null, branch: { is: { companyId } } },
        { userId: null, branchId: null }, // legacy rows without scope
      ],
    };
  }

  async list(
    companyId: string,
    query: ListSalesTargetsQueryDto,
  ): Promise<SalesTargetListResponse> {
    const {
      search,
      type,
      branchId,
      userId,
      status,
      period,
      from,
      to,
      page,
      perPage,
    } = query;

    const where: Prisma.SalesTargetWhereInput = {
      ...this.tenantWhere(companyId),
    };
    if (type) where.type = type;
    if (branchId) where.branchId = branchId;
    if (userId) where.userId = userId;
    if (period) where.period = period;
    if (search) {
      where.OR = [{ user: { is: { name: { contains: search, mode: "insensitive" } } } }];
    }
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }
    if (status === "ACTIVE") where.isActive = true;
    if (status === "FAILED" || status === "COMPLETED") {
      // status derived; keep all and filter later
    }

    const [rows, total] = await Promise.all([
      this.repo.findMany(where, (page - 1) * perPage, perPage),
      this.repo.count(where),
    ]);

    let mapped = await Promise.all(
      rows.map((r) => this.toSalesTargetResponse(r)),
    );

    if (status === "ACTIVE") mapped = mapped.filter((m) => m.status === "ACTIVE");
    if (status === "COMPLETED") {
      mapped = mapped.filter((m) => m.status === "COMPLETED");
    }
    if (status === "FAILED") mapped = mapped.filter((m) => m.status === "FAILED");

    return {
      salesTargets: mapped,
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<SalesTargetResponse> {
    const target = await this.repo.findOne({
      id,
      ...this.tenantWhere(companyId),
    });
    if (!target) throw new NotFoundException("Sales target not found");
    return this.toSalesTargetResponse(target);
  }

  async current(companyId: string): Promise<SalesTargetResponse[]> {
    const now = new Date();
    const rows = await this.repo.findManyActive(this.tenantWhere(companyId));

    const mapped = await Promise.all(
      rows.map((r) => this.toSalesTargetResponse(r)),
    );
    return mapped.filter((m) => {
      const start = new Date(m.startDate);
      const end = new Date(m.endDate);
      return start <= now && now <= end;
    });
  }

  async create(
    companyId: string,
    userId: string,
    dto: CreateSalesTargetDto,
  ): Promise<SalesTargetResponse> {
    await this.assertReferences(companyId, dto);

    const period = dto.period ?? this.derivePeriod(dto.type, dto.startDate);
    const targetRevenue =
      dto.targetRevenue ?? dto.targetAmount ?? null;

    try {
      const created = await this.repo.create({
        userId: dto.userId ?? null,
        branchId: dto.branchId ?? null,
        type: dto.type,
        targetRevenue,
        targetTx: dto.targetTx ?? null,
        targetItems: dto.targetItems ?? null,
        period,
        isActive: dto.isActive ?? true,
        createdBy: userId,
      });
      return this.toSalesTargetResponse(created);
    } catch (err) {
      throwOnDup(err);
      throw err;
    }
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateSalesTargetDto,
  ): Promise<SalesTargetResponse> {
    const existing = await this.repo.findExistence({
      id,
      ...this.tenantWhere(companyId),
    });
    if (!existing) throw new NotFoundException("Sales target not found");

    await this.assertReferences(companyId, dto);

    const data: Prisma.SalesTargetUpdateInput = {};
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.userId !== undefined) {
      data.user = dto.userId
        ? { connect: { id: dto.userId } }
        : { disconnect: true };
    }
    if (dto.branchId !== undefined) {
      data.branch = dto.branchId
        ? { connect: { id: dto.branchId } }
        : { disconnect: true };
    }
    if (dto.targetRevenue !== undefined) data.targetRevenue = dto.targetRevenue;
    if (dto.targetAmount !== undefined && dto.targetRevenue === undefined) {
      data.targetRevenue = dto.targetAmount;
    }
    if (dto.targetTx !== undefined) data.targetTx = dto.targetTx;
    if (dto.targetItems !== undefined) data.targetItems = dto.targetItems;
    if (dto.period !== undefined) data.period = dto.period;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    try {
      const updated = await this.repo.update(id, data);
      return this.toSalesTargetResponse(updated);
    } catch (err) {
      throwOnDup(err);
      throw err;
    }
  }

  // Re-compute achieved revenue/tx/items for the target's period; toggle isActive.
  async recompute(
    companyId: string,
    id: string,
  ): Promise<SalesTargetResponse> {
    const existing = await this.repo.findOne({
      id,
      ...this.tenantWhere(companyId),
    });
    if (!existing) throw new NotFoundException("Sales target not found");

    const { start, end } = this.getPeriodRange(existing.type, existing.period);
    const achieved = await this.computeAchievement(
      companyId,
      existing.userId,
      existing.branchId,
      start,
      end,
    );

    const now = new Date();
    const targetRev = existing.targetRevenue ?? 0;
    let isActive = existing.isActive;
    if (targetRev > 0 && achieved.revenue >= targetRev) {
      isActive = false; // completed
    } else if (now > end) {
      isActive = false; // failed
    } else {
      isActive = true;
    }

    const updated = await this.repo.update(id, { isActive });

    return this.toSalesTargetResponse(updated, achieved);
  }

  async delete(
    companyId: string,
    id: string,
  ): Promise<{ success: true }> {
    const existing = await this.repo.findExistence({
      id,
      ...this.tenantWhere(companyId),
    });
    if (!existing) throw new NotFoundException("Sales target not found");
    await this.repo.delete(id);
    return { success: true };
  }

  // ── Leaderboard ────────────────────────────────────────────────────────────
  // Port dari apps/web/src/server/actions/sales-targets.ts:getLeaderboard.
  // Tenant scope via branch.companyId pada transaksi.
  async leaderboard(
    companyId: string,
    query: LeaderboardQueryDto,
  ): Promise<LeaderboardResponse> {
    const type: SalesTargetTypeDto = query.type ?? "MONTHLY";
    const period = query.period ?? this.getCurrentPeriod(type);
    const { start, end } = this.getPeriodRange(type, period);

    const txWhere: Prisma.TransactionWhereInput = {
      status: "COMPLETED",
      createdAt: { gte: start, lte: end },
      branch: { is: { companyId } },
    };
    if (query.branchId) txWhere.branchId = query.branchId;

    const [salesAgg, itemsRaw, targets, badges] = await Promise.all([
      this.repo.groupTransactionsByUser(txWhere),
      this.repo.groupTransactionItemsByTransaction({
        transaction: { is: txWhere },
      }),
      this.repo.findTargetsByPeriod(type, period),
      this.repo.findBadgesByPeriod(period),
    ]);

    // Map transactionId -> quantity sum, then resolve userId via lookup.
    const txIds = itemsRaw.map((i) => i.transactionId);
    const txUsers = await this.repo.findTransactionUsers(txIds);
    const txUserMap = new Map(txUsers.map((t) => [t.id, t.userId]));
    const itemsMap = new Map<string, number>();
    for (const row of itemsRaw) {
      const userId = txUserMap.get(row.transactionId);
      if (!userId) continue;
      itemsMap.set(
        userId,
        (itemsMap.get(userId) ?? 0) + (row._sum.quantity ?? 0),
      );
    }

    const targetMap = new Map<string, number>();
    for (const t of targets) {
      if (t.userId && t.targetRevenue) targetMap.set(t.userId, t.targetRevenue);
    }

    const badgesMap = new Map<string, { badge: string; title: string }[]>();
    for (const b of badges) {
      if (!badgesMap.has(b.userId)) badgesMap.set(b.userId, []);
      badgesMap.get(b.userId)!.push({ badge: b.badge, title: b.title });
    }

    const userIds = salesAgg.map((s) => s.userId).filter(Boolean) as string[];
    const users = await this.repo.findUsersByIds(userIds);
    const userMap = new Map(users.map((u) => [u.id, u]));

    let leaderboard: LeaderboardEntryDto[] = salesAgg
      .map((s) => {
        if (!s.userId) return null;
        const user = userMap.get(s.userId);
        if (!user) return null;
        const revenue = s._sum.grandTotal ?? 0;
        const target = targetMap.get(s.userId) ?? 0;
        const percentage = target > 0 ? Math.round((revenue / target) * 100) : 0;
        return {
          rank: 0,
          userId: s.userId,
          name: user.name,
          avatarInitial: user.name.charAt(0).toUpperCase(),
          revenue,
          target,
          percentage,
          transactions: s._count._all,
          itemsSold: itemsMap.get(s.userId) ?? 0,
          badges: badgesMap.get(s.userId) ?? [],
        };
      })
      .filter(Boolean) as LeaderboardEntryDto[];

    leaderboard.sort((a, b) => b.revenue - a.revenue);
    leaderboard.forEach((entry, i) => {
      entry.rank = i + 1;
    });
    if (query.limit && query.limit > 0) {
      leaderboard = leaderboard.slice(0, query.limit);
    }

    return { leaderboard, period, type };
  }

  // ── Badges (CashierBadge model -- sales/manager facing) ─────────────────
  async listBadges(
    companyId: string,
    query: GetSalesBadgesQueryDto,
  ): Promise<SalesBadgeResponse[]> {
    const where: Prisma.CashierBadgeWhereInput = {
      // Scope ke user dalam company aktif.
      user: { is: { companyId } },
    };
    if (query.userId) where.userId = query.userId;

    const rows = await this.repo.findManyBadges(where);

    return rows.map((b) => ({
      id: b.id,
      userId: b.userId,
      badge: b.badge,
      title: b.title,
      description: b.description ?? null,
      period: b.period ?? null,
      earnedAt: b.earnedAt.toISOString(),
      user: b.user ? { id: b.user.id, name: b.user.name } : null,
    }));
  }

  // Auto-award badges berdasarkan agregasi transaksi periode (port apa adanya
  // dari apps/web/src/server/actions/sales-targets.ts:evaluateAndAwardBadges).
  async evaluateAndAwardBadges(
    companyId: string,
    body: EvaluateBadgesDto,
  ): Promise<EvaluateBadgesResponse> {
    const type: SalesTargetTypeDto = "MONTHLY";
    const currentPeriod = body.period ?? this.getCurrentPeriod(type);
    const { start, end } = this.getPeriodRange(type, currentPeriod);

    // Tenant scope via branch.companyId pada transaksi.
    const tenantTx: Prisma.TransactionWhereInput = {
      branch: { is: { companyId } },
    };
    const txWhere: Prisma.TransactionWhereInput = {
      ...tenantTx,
      status: "COMPLETED",
      createdAt: { gte: start, lte: end },
    };

    const [salesAgg, voidAgg, targets, earlyBirdAgg, nightOwlAgg, branchAgg] =
      await Promise.all([
        this.repo.groupTransactionsByUser(txWhere),
        this.repo.groupTransactionsByUser({
          ...tenantTx,
          status: "VOIDED",
          createdAt: { gte: start, lte: end },
        }),
        this.repo.findTargetsByPeriod(type, currentPeriod),
        this.repo.findEarlyBirdTop(companyId, start, end),
        this.repo.findNightOwlTop(companyId, start, end),
        this.repo.findTeamPlayerTop(companyId, start, end),
      ]);

    const awarded: { userId: string; badge: string; title: string }[] = [];

    const award = async (userId: string, badgeKey: string): Promise<void> => {
      const def = BADGE_DEFINITIONS.find((b) => b.key === badgeKey);
      if (!def) return;

      const exists = await this.repo.findBadgeExistence(
        userId,
        badgeKey,
        currentPeriod,
      );
      if (exists) return;

      await this.repo.createBadge({
        userId,
        badge: badgeKey,
        title: def.title,
        description: def.description,
        period: currentPeriod,
      });
      awarded.push({ userId, badge: badgeKey, title: def.title });
    };

    const voidMap = new Map(
      voidAgg.map((v) => [v.userId, v._count._all] as const),
    );
    const targetMap = new Map(
      targets.map((t) => [t.userId, t] as const),
    );

    const sortedByRevenue = [...salesAgg].sort(
      (a, b) => (b._sum.grandTotal ?? 0) - (a._sum.grandTotal ?? 0),
    );
    const topSeller = sortedByRevenue[0];
    if (topSeller?.userId) await award(topSeller.userId, "TOP_SELLER");

    const sortedByTx = [...salesAgg].sort(
      (a, b) => b._count._all - a._count._all,
    );
    const speedDemon = sortedByTx[0];
    if (speedDemon?.userId) await award(speedDemon.userId, "SPEED_DEMON");

    for (const s of salesAgg) {
      if (!s.userId) continue;
      const voidCount = voidMap.get(s.userId) ?? 0;
      if (voidCount === 0) await award(s.userId, "ZERO_VOID");

      const target = targetMap.get(s.userId);
      if (
        target?.targetRevenue &&
        (s._sum.grandTotal ?? 0) >= target.targetRevenue * 1.2
      ) {
        await award(s.userId, "TARGET_CRUSHER");
      }
    }

    const earlyBird = earlyBirdAgg[0];
    if (earlyBird && Number(earlyBird.cnt) > 0) {
      await award(earlyBird.userId, "EARLY_BIRD");
    }

    const nightOwl = nightOwlAgg[0];
    if (nightOwl && Number(nightOwl.cnt) > 0) {
      await award(nightOwl.userId, "NIGHT_OWL");
    }

    const teamPlayer = branchAgg[0];
    if (teamPlayer && Number(teamPlayer.branchCount) > 1) {
      await award(teamPlayer.userId, "TEAM_PLAYER");
    }

    // STREAK_7: cek daily target 7 hari terakhir berturut-turut tercapai.
    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 7);

    const dailyTargets = await this.repo.findDailyTargets(
      companyId,
      toDateOnly(sevenDaysAgo),
      toDateOnly(today),
    );

    const userDailyTargets = new Map<string, typeof dailyTargets>();
    for (const dt of dailyTargets) {
      if (!dt.userId) continue;
      if (!userDailyTargets.has(dt.userId)) userDailyTargets.set(dt.userId, []);
      userDailyTargets.get(dt.userId)!.push(dt);
    }

    for (const [userId, dts] of userDailyTargets) {
      if (dts.length < 7) continue;
      let streakCount = 0;
      for (const dt of dts) {
        const dayRange = this.getPeriodRange("DAILY", dt.period);
        const daySales = await this.repo.aggregateTransactionRevenue({
          userId,
          status: "COMPLETED",
          createdAt: { gte: dayRange.start, lte: dayRange.end },
        });
        if (
          dt.targetRevenue &&
          (daySales._sum.grandTotal ?? 0) >= dt.targetRevenue
        ) {
          streakCount++;
        }
      }
      if (streakCount >= 7) await award(userId, "STREAK_7");
    }

    return { awarded, period: currentPeriod };
  }

  private getCurrentPeriod(type: SalesTargetTypeDto): string {
    const now = new Date();
    if (type === "DAILY") return toDateOnly(now);
    if (type === "WEEKLY") {
      const d = new Date(
        Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
      );
      d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil(
        ((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
      );
      return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
    }
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async assertReferences(
    companyId: string,
    dto: CreateSalesTargetDto | UpdateSalesTargetDto,
  ) {
    if (dto.userId) {
      const user = await this.repo.findUserInCompany(dto.userId, companyId);
      if (!user) throw new NotFoundException("User not found");
    }
    if (dto.branchId) {
      const branch = await this.repo.findBranchInCompany(dto.branchId, companyId);
      if (!branch) throw new NotFoundException("Branch not found");
    }
  }

  private derivePeriod(type: SalesTargetTypeDto, startDate?: string): string {
    const d = startDate ? new Date(startDate) : new Date();
    if (type === "DAILY") return toDateOnly(d);
    if (type === "WEEKLY") {
      const tmp = new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
      );
      tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
      const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil(
        ((tmp.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
      );
      return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
    }
    if (type === "QUARTERLY") {
      const q = Math.floor(d.getMonth() / 3) + 1;
      return `${d.getFullYear()}-Q${q}`;
    }
    if (type === "YEARLY") return `${d.getFullYear()}`;
    if (type === "CUSTOM")
      return `CUSTOM-${toDateOnly(d)}`;
    // MONTHLY
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  private getPeriodRange(
    type: string,
    period: string,
  ): { start: Date; end: Date } {
    if (type === "DAILY") {
      const start = new Date(`${period}T00:00:00.000Z`);
      const end = new Date(`${period}T23:59:59.999Z`);
      return { start, end };
    }
    if (type === "WEEKLY") {
      const [yearStr, weekStr] = period.split("-W");
      const year = Number(yearStr ?? new Date().getFullYear());
      const week = Number(weekStr ?? 1);
      const jan4 = new Date(Date.UTC(year, 0, 4));
      const dayOfWeek = jan4.getUTCDay() || 7;
      const startOfWeek1 = new Date(jan4);
      startOfWeek1.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1);
      const start = new Date(startOfWeek1);
      start.setUTCDate(startOfWeek1.getUTCDate() + (week - 1) * 7);
      const end = new Date(start);
      end.setUTCDate(start.getUTCDate() + 6);
      end.setUTCHours(23, 59, 59, 999);
      return { start, end };
    }
    if (type === "QUARTERLY") {
      const [yearStr, qStr] = period.split("-Q");
      const year = Number(yearStr ?? new Date().getFullYear());
      const q = Number(qStr ?? 1);
      const startMonth = (q - 1) * 3;
      const start = new Date(Date.UTC(year, startMonth, 1));
      const end = new Date(Date.UTC(year, startMonth + 3, 0, 23, 59, 59, 999));
      return { start, end };
    }
    if (type === "YEARLY") {
      const year = Number(period);
      return {
        start: new Date(Date.UTC(year, 0, 1)),
        end: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)),
      };
    }
    if (type === "CUSTOM") {
      const dateStr = period.replace(/^CUSTOM-/, "");
      return {
        start: new Date(`${dateStr}T00:00:00.000Z`),
        end: new Date(`${dateStr}T23:59:59.999Z`),
      };
    }
    // MONTHLY
    const [yearStr, monthStr] = period.split("-");
    const year = Number(yearStr ?? new Date().getFullYear());
    const month = Number(monthStr ?? 1) - 1;
    return {
      start: new Date(Date.UTC(year, month, 1)),
      end: new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999)),
    };
  }

  private async computeAchievement(
    companyId: string,
    userId: string | null,
    branchId: string | null,
    start: Date,
    end: Date,
  ): Promise<{ revenue: number; tx: number; items: number }> {
    const txWhere: Prisma.TransactionWhereInput = {
      status: "COMPLETED",
      createdAt: { gte: start, lte: end },
      branch: { is: { companyId } },
    };
    if (userId) txWhere.userId = userId;
    if (branchId) txWhere.branchId = branchId;

    const [agg, itemsAgg] = await Promise.all([
      this.repo.aggregateTransactions(txWhere),
      this.repo.aggregateTransactionItems({
        transaction: { is: txWhere },
      }),
    ]);

    return {
      revenue: agg._sum.grandTotal ?? 0,
      tx: agg._count._all ?? 0,
      items: itemsAgg._sum.quantity ?? 0,
    };
  }

  private async toSalesTargetResponse(
    t: RawSalesTarget,
    achievedHint?: { revenue: number; tx: number; items: number },
  ): Promise<SalesTargetResponse> {
    const { start, end } = this.getPeriodRange(t.type, t.period);
    let achieved = achievedHint;
    if (!achieved) {
      // Derive achieved revenue inline (light-weight for list view).
      // Use null companyId guard: sum without company filter is fine because
      // userId/branchId already constrain.
      const txWhere: Prisma.TransactionWhereInput = {
        status: "COMPLETED",
        createdAt: { gte: start, lte: end },
      };
      if (t.userId) txWhere.userId = t.userId;
      if (t.branchId) txWhere.branchId = t.branchId;

      const agg = await this.repo.aggregateTransactions(txWhere);
      achieved = {
        revenue: agg._sum.grandTotal ?? 0,
        tx: agg._count._all ?? 0,
        items: 0,
      };
    }

    const now = new Date();
    const targetRev = t.targetRevenue ?? 0;
    let status: SalesTargetStatusDto = "ACTIVE";
    if (targetRev > 0 && achieved.revenue >= targetRev) status = "COMPLETED";
    else if (now > end) status = "FAILED";

    return {
      id: t.id,
      name: null,
      type: t.type,
      branchId: t.branchId,
      branch: t.branch ? { id: t.branch.id, name: t.branch.name } : null,
      userId: t.userId,
      user: t.user
        ? {
            id: t.user.id,
            name: t.user.name,
            email: t.user.email,
            role: t.user.role,
          }
        : null,
      targetRevenue: t.targetRevenue,
      targetTx: t.targetTx,
      targetItems: t.targetItems,
      period: t.period,
      isActive: t.isActive,
      achievedAmount: achieved.revenue,
      achievedTx: achieved.tx,
      achievedItems: achieved.items,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      status,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }
}

function throwOnDup(err: unknown): void {
  throwIfUniqueConstraint(err, "Sales target sudah ada untuk user/type/period tersebut");
}
