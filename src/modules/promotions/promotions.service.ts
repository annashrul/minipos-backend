import {
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { throwIfUniqueConstraint } from "@/common/utils/prisma-errors";
import type {
  CreatePromotionDto,
  ListPromotionsQueryDto,
  PromotionResponse,
  UpdatePromotionDto,
} from "./dto/promotions.dto";
import type { PaginatedResponse } from "@/common/types/response";
import { paginate } from "@/common/utils/pagination";
import { PrismaService } from "@/modules/prisma/prisma.service";
import {
  PROMOTION_SELECT,
  PromotionsRepository,
  type RawPromotion,
} from "./promotions.repository";

@Injectable()
export class PromotionsService {
  constructor(
    private readonly repo: PromotionsRepository,
    private readonly prisma: PrismaService,
  ) {}

  async list(
    companyId: string,
    query: ListPromotionsQueryDto,
  ): Promise<PaginatedResponse<PromotionResponse>> {
    const {
      search,
      type,
      isActive,
      scope,
      branchId,
      active,
      page,
      perPage,
    } = query;

    const where: Prisma.PromotionWhereInput = { companyId };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { voucherCode: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }
    if (type) where.type = type;
    if (isActive !== undefined) where.isActive = isActive;
    if (scope) where.scope = scope;
    if (branchId) where.branchId = branchId;
    if (active === true) {
      const now = new Date();
      where.isActive = true;
      where.startDate = { lte: now };
      where.endDate = { gte: now };
    } else if (active === false) {
      const now = new Date();
      where.OR = [
        ...(where.OR ?? []),
        { isActive: false },
        { startDate: { gt: now } },
        { endDate: { lt: now } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.repo.findMany(where, (page - 1) * perPage, perPage),
      this.repo.count(where),
    ]);

    const getProductMap = await this.fetchGetProducts(rows);
    return paginate(
      rows.map((row) =>
        toPromotionResponse(row, getProductMap.get(row.getProductId ?? "") ?? null),
      ),
      total,
      page,
      perPage,
    );
  }

  async findById(companyId: string, id: string): Promise<PromotionResponse> {
    const promotion = await this.repo.findOne({ id, companyId });
    if (!promotion) throw new NotFoundException("Promosi tidak ditemukan");
    const getProductMap = await this.fetchGetProducts([promotion]);
    return toPromotionResponse(
      promotion,
      getProductMap.get(promotion.getProductId ?? "") ?? null,
    );
  }

  private async fetchGetProducts(
    rows: { getProductId: string | null }[],
  ): Promise<Map<string, { id: string; name: string; code: string }>> {
    const ids = Array.from(
      new Set(
        rows
          .map((r) => r.getProductId)
          .filter((v): v is string => Boolean(v)),
      ),
    );
    return this.repo.fetchGetProducts(ids);
  }

  async create(
    companyId: string,
    dto: CreatePromotionDto,
  ): Promise<PromotionResponse> {
    await this.assertReferences(companyId, dto);

    const triggerIds = dedupeTriggerIds(dto.triggerProductIds);
    const getIds = dedupeTriggerIds(dto.getProductIds);

    try {
      const created = await this.repo.create({
        name: dto.name,
        type: dto.type,
        value: dto.value,
        minPurchase: dto.minPurchase ?? null,
        maxDiscount: dto.maxDiscount ?? null,
        scope: dto.scope ?? "all",
        categoryId: dto.categoryId ?? null,
        productId: dto.productId ?? null,
        branchId: dto.branchId ?? null,
        buyQty: dto.buyQty ?? null,
        getQty: dto.getQty ?? null,
        getProductId: getIds.length ? null : (dto.getProductId ?? null),
        voucherCode: dto.voucherCode ?? null,
        usageLimit: dto.usageLimit ?? null,
        description: dto.description ?? null,
        isActive: dto.isActive ?? true,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        companyId,
        triggerProducts: triggerIds.length
          ? {
              create: triggerIds.map((productId) => ({ productId })),
            }
          : undefined,
        getProducts: getIds.length
          ? {
              create: getIds.map((productId) => ({ productId })),
            }
          : undefined,
      });
      const map = await this.fetchGetProducts([created]);
      return toPromotionResponse(
        created,
        map.get(created.getProductId ?? "") ?? null,
      );
    } catch (err) {
      throwOnDup(err);
      throw err;
    }
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdatePromotionDto,
  ): Promise<PromotionResponse> {
    const existing = await this.repo.findById({ id, companyId });
    if (!existing) throw new NotFoundException("Promosi tidak ditemukan");

    await this.assertReferences(companyId, dto);

    const data: Prisma.PromotionUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.value !== undefined) data.value = dto.value;
    if (dto.minPurchase !== undefined) data.minPurchase = dto.minPurchase;
    if (dto.maxDiscount !== undefined) data.maxDiscount = dto.maxDiscount;
    if (dto.scope !== undefined) data.scope = dto.scope;
    if (dto.categoryId !== undefined) {
      data.category = dto.categoryId
        ? { connect: { id: dto.categoryId } }
        : { disconnect: true };
    }
    if (dto.productId !== undefined) {
      data.product = dto.productId
        ? { connect: { id: dto.productId } }
        : { disconnect: true };
    }
    if (dto.branchId !== undefined) {
      data.branch = dto.branchId
        ? { connect: { id: dto.branchId } }
        : { disconnect: true };
    }
    if (dto.buyQty !== undefined) data.buyQty = dto.buyQty;
    if (dto.getQty !== undefined) data.getQty = dto.getQty;
    if (dto.getProductId !== undefined) data.getProductId = dto.getProductId;
    if (dto.getProductIds && dto.getProductIds.length > 0) {
      data.getProductId = null;
    }
    if (dto.voucherCode !== undefined) data.voucherCode = dto.voucherCode;
    if (dto.usageLimit !== undefined) data.usageLimit = dto.usageLimit;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) data.endDate = new Date(dto.endDate);

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        if (dto.triggerProductIds !== undefined) {
          const triggerIds = dedupeTriggerIds(dto.triggerProductIds);
          await tx.promotionTriggerProduct.deleteMany({
            where: { promoId: id },
          });
          if (triggerIds.length) {
            await tx.promotionTriggerProduct.createMany({
              data: triggerIds.map((productId) => ({
                promoId: id,
                productId,
              })),
            });
          }
        }
        if (dto.getProductIds !== undefined) {
          const getIds = dedupeTriggerIds(dto.getProductIds);
          await tx.promotionGetProduct.deleteMany({
            where: { promoId: id },
          });
          if (getIds.length) {
            await tx.promotionGetProduct.createMany({
              data: getIds.map((productId) => ({
                promoId: id,
                productId,
              })),
            });
          }
        }
        return tx.promotion.update({
          where: { id },
          data,
          select: PROMOTION_SELECT,
        });
      });
      const map = await this.fetchGetProducts([updated]);
      return toPromotionResponse(
        updated,
        map.get(updated.getProductId ?? "") ?? null,
      );
    } catch (err) {
      throwOnDup(err);
      throw err;
    }
  }

  async stats(companyId: string) {
    const now = new Date();
    const where: Prisma.PromotionWhereInput = { companyId };

    const [total, active, expired, byTypeRaw] = await Promise.all([
      this.repo.count(where),
      this.repo.count({
        ...where,
        isActive: true,
        endDate: { gte: now },
      }),
      this.repo.count({ ...where, endDate: { lt: now } }),
      this.repo.groupByType(where),
    ]);

    const typeMap = new Map(byTypeRaw.map((g) => [g.type, g._count._all]));
    return {
      total,
      active,
      expired,
      byType: {
        DISCOUNT_PERCENT: typeMap.get("DISCOUNT_PERCENT") ?? 0,
        DISCOUNT_AMOUNT: typeMap.get("DISCOUNT_AMOUNT") ?? 0,
        BUY_X_GET_Y: typeMap.get("BUY_X_GET_Y") ?? 0,
        VOUCHER: typeMap.get("VOUCHER") ?? 0,
        BUNDLE: typeMap.get("BUNDLE") ?? 0,
      },
    };
  }

  async toggle(
    companyId: string,
    id: string,
    isActive: boolean,
  ): Promise<PromotionResponse> {
    const existing = await this.repo.findById({ id, companyId });
    if (!existing) throw new NotFoundException("Promosi tidak ditemukan");

    const updated = await this.repo.update(id, { isActive });
    const map = await this.fetchGetProducts([updated]);
    return toPromotionResponse(
      updated,
      map.get(updated.getProductId ?? "") ?? null,
    );
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const existing = await this.repo.findById({ id, companyId });
    if (!existing) throw new NotFoundException("Promosi tidak ditemukan");
    await this.repo.delete(id);
    return { success: true };
  }

  private async assertReferences(
    companyId: string,
    dto: CreatePromotionDto | UpdatePromotionDto,
  ) {
    if (dto.branchId) {
      const branch = await this.repo.assertBranch(companyId, dto.branchId);
      if (!branch) throw new NotFoundException("Branch not found");
    }
    if (dto.categoryId) {
      const category = await this.repo.assertCategory(companyId, dto.categoryId);
      if (!category) throw new NotFoundException("Category not found");
    }
    if (dto.productId) {
      const product = await this.repo.assertProduct(companyId, dto.productId);
      if (!product) throw new NotFoundException("Produk tidak ditemukan");
    }
    if (dto.getProductId) {
      const product = await this.repo.assertProduct(companyId, dto.getProductId);
      if (!product) throw new NotFoundException("Produk tidak ditemukan");
    }
    if (dto.triggerProductIds && dto.triggerProductIds.length) {
      const ids = dedupeTriggerIds(dto.triggerProductIds);
      const found = await this.repo.assertProducts(companyId, ids);
      if (found.length !== ids.length) {
        throw new NotFoundException(
          "Salah satu trigger product tidak ditemukan",
        );
      }
    }
    if (dto.getProductIds && dto.getProductIds.length) {
      const ids = dedupeTriggerIds(dto.getProductIds);
      const found = await this.repo.assertProducts(companyId, ids);
      if (found.length !== ids.length) {
        throw new NotFoundException(
          "Salah satu produk tebus tidak ditemukan",
        );
      }
    }
  }
}

function dedupeTriggerIds(ids: string[] | null | undefined): string[] {
  if (!ids || !ids.length) return [];
  return Array.from(new Set(ids.filter(Boolean)));
}

function toPromotionResponse(
  p: RawPromotion,
  getProduct: { id: string; name: string; code: string } | null,
): PromotionResponse {
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    value: p.value,
    minPurchase: p.minPurchase,
    maxDiscount: p.maxDiscount,
    scope: p.scope,
    categoryId: p.categoryId,
    category: p.category ? { id: p.category.id, name: p.category.name } : null,
    productId: p.productId,
    product: p.product
      ? { id: p.product.id, name: p.product.name, code: p.product.code }
      : null,
    branchId: p.branchId,
    branch: p.branch ? { id: p.branch.id, name: p.branch.name } : null,
    buyQty: p.buyQty,
    getQty: p.getQty,
    getProductId: p.getProductId,
    voucherCode: p.voucherCode,
    usageLimit: p.usageLimit,
    usageCount: p.usageCount,
    description: p.description,
    isActive: p.isActive,
    startDate: p.startDate.toISOString(),
    endDate: p.endDate.toISOString(),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    triggerProducts: (p.triggerProducts ?? []).map((tp) => ({
      id: tp.product.id,
      name: tp.product.name,
      code: tp.product.code,
    })),
    getProduct,
    getProducts: (p.getProducts ?? []).map((gp) => ({
      id: gp.product.id,
      name: gp.product.name,
      code: gp.product.code,
    })),
  };
}

function throwOnDup(err: unknown): void {
  throwIfUniqueConstraint(err, "Voucher code sudah digunakan");
}
