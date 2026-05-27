import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export const GROUP_INCLUDE = {
  options: {
    orderBy: { sortOrder: "asc" } as const,
    include: {
      enabledBy: { select: { parentOptionId: true } },
    },
  },
} satisfies Prisma.ModifierGroupInclude;

export type RawModifierGroup = Prisma.ModifierGroupGetPayload<{
  include: typeof GROUP_INCLUDE;
}>;

@Injectable()
export class ModifiersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    where: Prisma.ModifierGroupWhereInput,
    orderBy: Prisma.ModifierGroupOrderByWithRelationInput,
    skip: number,
    take: number,
  ): Promise<RawModifierGroup[]> {
    return this.prisma.modifierGroup.findMany({
      where,
      include: GROUP_INCLUDE,
      orderBy,
      skip,
      take,
    });
  }

  async count(where: Prisma.ModifierGroupWhereInput): Promise<number> {
    return this.prisma.modifierGroup.count({ where });
  }

  async findOne(
    where: Prisma.ModifierGroupWhereInput,
  ): Promise<RawModifierGroup | null> {
    return this.prisma.modifierGroup.findFirst({
      where,
      include: GROUP_INCLUDE,
    });
  }

  async findExists(
    where: Prisma.ModifierGroupWhereInput,
  ): Promise<{ id: string } | null> {
    return this.prisma.modifierGroup.findFirst({
      where,
      select: { id: true },
    });
  }

  async create(
    data: Prisma.ModifierGroupUncheckedCreateInput,
  ): Promise<RawModifierGroup> {
    return this.prisma.modifierGroup.create({
      data,
      include: GROUP_INCLUDE,
    });
  }

  async createDependencies(
    deps: { parentOptionId: string; dependentOptionId: string }[],
  ): Promise<void> {
    await this.prisma.modifierOptionDependency.createMany({
      data: deps,
      skipDuplicates: true,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.modifierGroup.delete({ where: { id } });
  }

  async findProductModifierGroups(
    productId: string,
    companyId: string,
  ): Promise<RawModifierGroup[]> {
    const links = await this.prisma.productModifierGroup.findMany({
      where: {
        productId,
        modifierGroup: { companyId },
      },
      orderBy: { sortOrder: "asc" },
      include: { modifierGroup: { include: GROUP_INCLUDE } },
    });
    return links.map((l) => l.modifierGroup);
  }

  async findProductExists(
    companyId: string,
    productId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.product.findFirst({
      where: { id: productId, companyId },
      select: { id: true },
    });
  }

  async findModifierGroupsByIds(
    companyId: string,
    ids: string[],
  ): Promise<{ id: string }[]> {
    return this.prisma.modifierGroup.findMany({
      where: { id: { in: ids }, companyId },
      select: { id: true },
    });
  }
}
