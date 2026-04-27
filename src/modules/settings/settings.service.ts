import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  ListSettingsQueryDto,
  SettingListResponse,
  SettingResponse,
  UpsertSettingDto,
  UpsertSettingsBulkDto,
} from "@/contracts";
import { PrismaService } from "../prisma/prisma.service";

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
  constructor(private readonly prisma: PrismaService) {}

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
    await this.prisma.setting.delete({ where: { id: existing.id } });
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
