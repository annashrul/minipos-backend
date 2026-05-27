import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/modules/prisma/prisma.service";
import type {
  CreateModifierGroupDto,
  ListModifierGroupsQueryDto,
  ModifierGroupResponse,
  UpdateModifierGroupDto,
  AttachProductModifierDto,
} from "./dto/modifiers.dto";
import type { PaginatedResponse } from "@/common/types/response";
import { paginate } from "@/common/utils/pagination";
import {
  ModifiersRepository,
  type RawModifierGroup,
} from "./modifiers.repository";

function toGroupResponse(g: RawModifierGroup): ModifierGroupResponse {
  return {
    id: g.id,
    name: g.name,
    required: g.required,
    minSelect: g.minSelect,
    maxSelect: g.maxSelect,
    sortOrder: g.sortOrder,
    isActive: g.isActive,
    options: g.options.map((o) => ({
      id: o.id,
      name: o.name,
      priceAdjustment: o.priceAdjustment,
      isActive: o.isActive,
      sortOrder: o.sortOrder,
      enabledByOptionIds: o.enabledBy.map((e) => e.parentOptionId),
    })),
    createdAt: g.createdAt.toISOString(),
    updatedAt: g.updatedAt.toISOString(),
  };
}

@Injectable()
export class ModifiersService {
  constructor(
    private readonly repo: ModifiersRepository,
    private readonly prisma: PrismaService,
  ) {}

  async list(
    companyId: string,
    query: ListModifierGroupsQueryDto,
  ): Promise<PaginatedResponse<ModifierGroupResponse>> {
    const { search, isActive, page, perPage, sortBy, sortDir } = query;
    const where: Prisma.ModifierGroupWhereInput = { companyId };
    if (search) where.name = { contains: search, mode: "insensitive" };
    if (isActive !== undefined) where.isActive = isActive;

    const dir: "asc" | "desc" = sortDir ?? "asc";
    let orderBy: Prisma.ModifierGroupOrderByWithRelationInput = {
      sortOrder: "asc",
    };
    if (sortBy) {
      switch (sortBy) {
        case "name":
        case "sortOrder":
        case "createdAt":
          orderBy = { [sortBy]: dir };
          break;
      }
    }

    const [rows, total] = await Promise.all([
      this.repo.findMany(where, orderBy, (page - 1) * perPage, perPage),
      this.repo.count(where),
    ]);

    return paginate(rows.map(toGroupResponse), total, page, perPage);
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<ModifierGroupResponse> {
    const group = await this.repo.findOne({ id, companyId });
    if (!group) throw new NotFoundException("Modifier group not found");
    return toGroupResponse(group);
  }

  async create(
    companyId: string,
    dto: CreateModifierGroupDto,
  ): Promise<ModifierGroupResponse> {
    if ((dto.maxSelect ?? 1) < (dto.minSelect ?? 0)) {
      throw new BadRequestException("maxSelect must be ≥ minSelect");
    }
    const created = await this.repo.create({
      companyId,
      name: dto.name,
      required: dto.required ?? false,
      minSelect: dto.minSelect ?? 0,
      maxSelect: dto.maxSelect ?? 1,
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
      options: dto.options?.length
        ? {
            create: dto.options.map((o, idx) => ({
              name: o.name,
              priceAdjustment: o.priceAdjustment ?? 0,
              isActive: o.isActive ?? true,
              sortOrder: o.sortOrder ?? idx,
            })),
          }
        : undefined,
    });

    // Persist dependencies (parent ada di group lain — biasanya sudah ada).
    // Match by name karena option baru belum punya id sebelum create.
    if (dto.options?.length) {
      const optionByName = new Map(
        created.options.map((o) => [o.name, o.id]),
      );
      const deps: { parentOptionId: string; dependentOptionId: string }[] = [];
      for (const o of dto.options) {
        const dependentId = optionByName.get(o.name);
        if (!dependentId || !o.enabledByOptionIds?.length) continue;
        for (const parentId of o.enabledByOptionIds) {
          deps.push({ parentOptionId: parentId, dependentOptionId: dependentId });
        }
      }
      if (deps.length) {
        await this.repo.createDependencies(deps);
      }
    }
    return this.findById(companyId, created.id);
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateModifierGroupDto,
  ): Promise<ModifierGroupResponse> {
    const existing = await this.repo.findExists({ id, companyId });
    if (!existing) throw new NotFoundException("Modifier group not found");

    if (
      dto.maxSelect !== undefined &&
      dto.minSelect !== undefined &&
      dto.maxSelect < dto.minSelect
    ) {
      throw new BadRequestException("maxSelect must be ≥ minSelect");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.modifierGroup.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.required !== undefined ? { required: dto.required } : {}),
          ...(dto.minSelect !== undefined ? { minSelect: dto.minSelect } : {}),
          ...(dto.maxSelect !== undefined ? { maxSelect: dto.maxSelect } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
      if (dto.options) {
        // Replace strategy: easier UX (full re-state from form).
        // Keep options whose id appears in payload, update them; create new
        // ones for entries without id; delete options not present.
        const incomingIds = dto.options
          .map((o: { id?: string }) => o.id)
          .filter((x: string | undefined): x is string => Boolean(x));
        await tx.modifierOption.deleteMany({
          where: { groupId: id, id: { notIn: incomingIds.length ? incomingIds : ["__none__"] } },
        });
        // Track final id per dto.options entry (untuk persist deps di bawah).
        const finalIds: string[] = [];
        for (let idx = 0; idx < dto.options.length; idx++) {
          const opt = dto.options[idx]!;
          if (opt.id) {
            await tx.modifierOption.update({
              where: { id: opt.id },
              data: {
                name: opt.name,
                priceAdjustment: opt.priceAdjustment ?? 0,
                isActive: opt.isActive ?? true,
                sortOrder: opt.sortOrder ?? idx,
              },
            });
            finalIds.push(opt.id);
          } else {
            const created = await tx.modifierOption.create({
              data: {
                groupId: id,
                name: opt.name,
                priceAdjustment: opt.priceAdjustment ?? 0,
                isActive: opt.isActive ?? true,
                sortOrder: opt.sortOrder ?? idx,
              },
            });
            finalIds.push(created.id);
          }
        }

        // Replace strategy untuk dependencies: hapus semua deps yang option
        // dependent-nya berada di group ini, lalu re-create dari payload.
        await tx.modifierOptionDependency.deleteMany({
          where: { dependentOption: { groupId: id } },
        });
        const newDeps: { parentOptionId: string; dependentOptionId: string }[] = [];
        for (let idx = 0; idx < dto.options.length; idx++) {
          const opt = dto.options[idx]!;
          const dependentId = finalIds[idx]!;
          if (!opt.enabledByOptionIds?.length) continue;
          for (const parentId of opt.enabledByOptionIds) {
            newDeps.push({ parentOptionId: parentId, dependentOptionId: dependentId });
          }
        }
        if (newDeps.length) {
          await tx.modifierOptionDependency.createMany({
            data: newDeps,
            skipDuplicates: true,
          });
        }
      }
    });

    return this.findById(companyId, id);
  }

  async remove(companyId: string, id: string) {
    const group = await this.repo.findExists({ id, companyId });
    if (!group) throw new NotFoundException("Modifier group not found");
    await this.repo.delete(id);
    return { success: true as const };
  }

  async summary(companyId: string) {
    const where = { companyId };
    const [total, active] = await Promise.all([
      this.repo.count(where),
      this.repo.count({ ...where, isActive: true }),
    ]);
    return { total, active, inactive: total - active };
  }

  // ── Product attachment ──────────────────────────────────────
  async listForProduct(
    companyId: string,
    productId: string,
  ): Promise<ModifierGroupResponse[]> {
    const groups = await this.repo.findProductModifierGroups(
      productId,
      companyId,
    );
    return groups.map(toGroupResponse);
  }

  async setProductGroups(
    companyId: string,
    dto: AttachProductModifierDto,
  ): Promise<{ success: true }> {
    // Verify ownership of product + groups
    const product = await this.repo.findProductExists(
      companyId,
      dto.productId,
    );
    if (!product) throw new NotFoundException("Product not found");

    const groups = await this.repo.findModifierGroupsByIds(
      companyId,
      dto.modifierGroupIds,
    );
    if (groups.length !== dto.modifierGroupIds.length) {
      throw new BadRequestException("One or more modifier groups invalid");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.productModifierGroup.deleteMany({
        where: { productId: dto.productId },
      });
      if (dto.modifierGroupIds.length) {
        await tx.productModifierGroup.createMany({
          data: dto.modifierGroupIds.map((groupId: string, idx: number) => ({
            productId: dto.productId,
            modifierGroupId: groupId,
            sortOrder: idx,
          })),
        });
      }
    });
    return { success: true };
  }
}
