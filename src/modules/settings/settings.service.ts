import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  ListSettingsQueryDto,
  SettingListResponse,
  SettingResponse,
  UpsertSettingDto,
  UpsertSettingsBulkDto,
} from "./dto/settings.dto";
import { PrismaService } from "../prisma/prisma.service";
import { EVENTS, RealtimeService } from "../realtime/realtime.service";

type SettingCategory = "pos" | "receipt" | "kitchen" | null;

function detectSettingCategory(
  group: string | null | undefined,
  key: string | null | undefined,
): SettingCategory {
  const haystack = `${group ?? ""}::${key ?? ""}`.toLowerCase();
  if (haystack.includes("kitchen")) return "kitchen";
  if (haystack.includes("receipt") || haystack.includes("struk")) {
    return "receipt";
  }
  if (haystack.includes("pos")) return "pos";
  return null;
}

const SETTING_SELECT = {
  id: true,
  key: true,
  value: true,
  label: true,
  group: true,
  branchId: true,
  updatedAt: true,
} satisfies Prisma.SettingSelect;

type RawSetting = Prisma.SettingGetPayload<{ select: typeof SETTING_SELECT }>;

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  private emitConfigEvent(
    category: SettingCategory,
    payload: Record<string, unknown>,
    branchId?: string | null,
  ) {
    const branch = branchId ?? undefined;
    if (category === "pos") {
      this.realtime.emit(EVENTS.CONFIG_POS_UPDATED, payload, branch);
      return;
    }
    if (category === "receipt") {
      this.realtime.emit(EVENTS.CONFIG_RECEIPT_UPDATED, payload, branch);
      return;
    }
    if (category === "kitchen") {
      this.realtime.emit(EVENTS.CONFIG_KITCHEN_UPDATED, payload, branch);
      return;
    }
    // Tidak bisa pastikan kategorinya — emit ke semua channel config
    // supaya client subscriber tetap menerima refresh signal.
    this.realtime.emit(EVENTS.CONFIG_POS_UPDATED, payload, branch);
    this.realtime.emit(EVENTS.CONFIG_RECEIPT_UPDATED, payload, branch);
    this.realtime.emit(EVENTS.CONFIG_KITCHEN_UPDATED, payload, branch);
  }

  async list(
    companyId: string,
    query: ListSettingsQueryDto,
  ): Promise<SettingListResponse> {
    const { group, branchId, keys } = query;

    const where: Prisma.SettingWhereInput = {
      OR: [
        { branchId: null },
        { branch: { companyId } },
      ],
    };
    if (group) where.group = group;
    if (branchId !== undefined) where.branchId = branchId;
    if (keys) {
      const keyList = keys
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);
      if (keyList.length > 0) where.key = { in: keyList };
    }

    const rows = await this.prisma.setting.findMany({
      where,
      select: SETTING_SELECT,
      orderBy: [{ group: "asc" }, { key: "asc" }],
    });

    return { settings: rows.map(toSettingResponse) };
  }

  async upsert(
    companyId: string,
    dto: UpsertSettingDto,
  ): Promise<SettingResponse> {
    if (dto.branchId) await this.assertBranch(companyId, dto.branchId);
    const result = await this.upsertOne(dto);
    this.emitConfigEvent(
      detectSettingCategory(result.group, result.key),
      { key: result.key, group: result.group },
      result.branchId,
    );
    return toSettingResponse(result);
  }

  async upsertBulk(
    companyId: string,
    dto: UpsertSettingsBulkDto,
  ): Promise<SettingListResponse> {
    const branchIds = Array.from(
      new Set(
        dto.settings
          .map((s) => s.branchId)
          .filter((v): v is string => typeof v === "string"),
      ),
    );
    if (branchIds.length > 0) {
      const valid = await this.prisma.branch.findMany({
        where: { id: { in: branchIds }, companyId },
        select: { id: true },
      });
      if (valid.length !== branchIds.length) {
        throw new NotFoundException("Salah satu branchId tidak ditemukan");
      }
    }

    const results: RawSetting[] = [];
    for (const s of dto.settings) {
      results.push(await this.upsertOne(s));
    }

    // Aggregate categories yang tersentuh agar emit cukup sekali per channel
    const seenCategories = new Set<SettingCategory>();
    let unknownInAggregate = false;
    for (const r of results) {
      const cat = detectSettingCategory(r.group, r.key);
      if (cat === null) unknownInAggregate = true;
      else seenCategories.add(cat);
    }
    const emitBranchIds = Array.from(
      new Set(results.map((r) => r.branchId ?? null)),
    );
    for (const branchId of emitBranchIds) {
      if (unknownInAggregate) {
        this.emitConfigEvent(null, { bulk: true }, branchId);
      } else {
        for (const cat of seenCategories) {
          this.emitConfigEvent(cat, { bulk: true }, branchId);
        }
      }
    }

    return { settings: results.map(toSettingResponse) };
  }

  async delete(
    companyId: string,
    key: string,
    branchId: string | null,
  ): Promise<{ success: true }> {
    if (branchId) await this.assertBranch(companyId, branchId);
    const existing = await this.prisma.setting.findFirst({
      where: { key, branchId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Setting not found");
    const deleted = await this.prisma.setting.delete({
      where: { id: existing.id },
      select: SETTING_SELECT,
    });
    this.emitConfigEvent(
      detectSettingCategory(deleted.group, deleted.key),
      { key: deleted.key, group: deleted.group, deleted: true },
      deleted.branchId,
    );
    return { success: true };
  }

  private async upsertOne(dto: UpsertSettingDto): Promise<RawSetting> {
    const branchId = dto.branchId ?? null;
    const existing = await this.prisma.setting.findFirst({
      where: { key: dto.key, branchId },
      select: { id: true },
    });
    if (existing) {
      return this.prisma.setting.update({
        where: { id: existing.id },
        data: {
          value: dto.value,
          label: dto.label ?? null,
          group: dto.group ?? null,
        },
        select: SETTING_SELECT,
      });
    }
    return this.prisma.setting.create({
      data: {
        key: dto.key,
        value: dto.value,
        label: dto.label ?? null,
        group: dto.group ?? null,
        branchId,
      },
      select: SETTING_SELECT,
    });
  }

  private async assertBranch(companyId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException("Branch not found");
  }
}

function toSettingResponse(s: RawSetting): SettingResponse {
  return {
    id: s.id,
    key: s.key,
    value: s.value,
    label: s.label,
    group: s.group,
    branchId: s.branchId,
    updatedAt: s.updatedAt.toISOString(),
  };
}
