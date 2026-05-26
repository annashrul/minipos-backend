import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const SETTING_SELECT = {
  id: true,
  key: true,
  value: true,
  label: true,
  group: true,
  branchId: true,
  updatedAt: true,
} satisfies Prisma.SettingSelect;

export type RawSetting = Prisma.SettingGetPayload<{
  select: typeof SETTING_SELECT;
}>;

@Injectable()
export class SettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    where: Prisma.SettingWhereInput,
  ): Promise<RawSetting[]> {
    return this.prisma.setting.findMany({
      where,
      select: SETTING_SELECT,
      orderBy: [{ group: "asc" }, { key: "asc" }],
    });
  }

  async findFirstByKeyAndBranch(
    key: string,
    branchId: string | null,
  ): Promise<{ id: string } | null> {
    return this.prisma.setting.findFirst({
      where: { key, branchId },
      select: { id: true },
    });
  }

  async update(
    id: string,
    data: Prisma.SettingUpdateInput,
  ): Promise<RawSetting> {
    return this.prisma.setting.update({
      where: { id },
      data,
      select: SETTING_SELECT,
    });
  }

  async create(
    data: Prisma.SettingUncheckedCreateInput,
  ): Promise<RawSetting> {
    return this.prisma.setting.create({
      data,
      select: SETTING_SELECT,
    });
  }

  async delete(id: string): Promise<RawSetting> {
    return this.prisma.setting.delete({
      where: { id },
      select: SETTING_SELECT,
    });
  }

  async countBranchesByIds(
    companyId: string,
    branchIds: string[],
  ): Promise<number> {
    const rows = await this.prisma.branch.findMany({
      where: { id: { in: branchIds }, companyId },
      select: { id: true },
    });
    return rows.length;
  }
}
