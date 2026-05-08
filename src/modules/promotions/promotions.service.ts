import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreatePromotionDto,
  ListPromotionsQueryDto,
  PromotionListResponse,
  PromotionResponse,
  UpdatePromotionDto,
} from "@/contracts";
import { PrismaService } from "../prisma/prisma.service";

const PROMOTION_SELECT = {
  id: true,
  name: true,
  type: true,
  value: true,
  minPurchase: true,
  maxDiscount: true,
  scope: true,
  categoryId: true,
  category: { select: { id: true, name: true } },
  productId: true,
  product: { select: { id: true, name: true, code: true } },
  branchId: true,
  branch: { select: { id: true, name: true } },
  buyQty: true,
  getQty: true,
  getProductId: true,
  voucherCode: true,
  usageLimit: true,
  usageCount: true,
  description: true,
  isActive: true,
  startDate: true,
  endDate: true,
  createdAt: true,
  updatedAt: true,
  triggerProducts: {
    include: { product: { select: { id: true, name: true, code: true } } },
  },
  getProducts: {
    include: { product: { select: { id: true, name: true, code: true } } },
  },
} satisfies Prisma.PromotionSelect;

type RawPromotion = Prisma.PromotionGetPayload<{
  select: typeof PROMOTION_SELECT;
}>;

@Injectable()
export class PromotionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    companyId: string,
    query: ListPromotionsQueryDto,
  ): Promise<PromotionListResponse> {
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
      this.prisma.promotion.findMany({
        where,
        select: PROMOTION_SELECT,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.promotion.count({ where }),
    ]);

    const getProductMap = await this.fetchGetProducts(rows);
    return {
      promotions: rows.map((row) =>
        toPromotionResponse(row, getProductMap.get(row.getProductId ?? "") ?? null),
      ),
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async findById(companyId: string, id: string): Promise<PromotionResponse> {
    const promotion = await this.prisma.promotion.findFirst({
      where: { id, companyId },
      select: PROMOTION_SELECT,
    });
    if (!promotion) throw new NotFoundException("Promotion not found");
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
    if (!ids.length) return new Map();
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, code: true },
    });
    return new Map(products.map((p) => [p.id, p]));
  }

  async create(
    companyId: string,
    dto: CreatePromotionDto,
  ): Promise<PromotionResponse> {
    await this.assertReferences(companyId, dto);

    const triggerIds = dedupeTriggerIds(dto.triggerProductIds);
    const getIds = dedupeTriggerIds(dto.getProductIds);

    try {
      const created = await this.prisma.promotion.create({
        data: {
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
          // Kalau pakai multi-reward (getProductIds), kosongkan getProductId
          // agar engine pakai tabel relasi sebagai source of truth.
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
        },
        select: PROMOTION_SELECT,
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
    const existing = await this.prisma.promotion.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Promotion not found");

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
    // Kalau caller kirim multi-reward, paksa kosongkan getProductId agar engine
    // konsisten ambil dari tabel relasi.
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
      // Replace strategy: kalau caller kirim triggerProductIds, hapus semua
      // entry lama lalu tulis ulang. Kalau field tidak dikirim (undefined),
      // biarkan apa adanya (tidak diubah).
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

  async toggle(
    companyId: string,
    id: string,
    isActive: boolean,
  ): Promise<PromotionResponse> {
    const existing = await this.prisma.promotion.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Promotion not found");

    const updated = await this.prisma.promotion.update({
      where: { id },
      data: { isActive },
      select: PROMOTION_SELECT,
    });
    const map = await this.fetchGetProducts([updated]);
    return toPromotionResponse(
      updated,
      map.get(updated.getProductId ?? "") ?? null,
    );
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const existing = await this.prisma.promotion.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Promotion not found");
    await this.prisma.promotion.delete({ where: { id } });
    return { success: true };
  }

  private async assertReferences(
    companyId: string,
    dto: CreatePromotionDto | UpdatePromotionDto,
  ) {
    if (dto.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: dto.branchId, companyId },
        select: { id: true },
      });
      if (!branch) throw new NotFoundException("Branch not found");
    }
    if (dto.categoryId) {
      const category = await this.prisma.category.findFirst({
        where: { id: dto.categoryId, companyId },
        select: { id: true },
      });
      if (!category) throw new NotFoundException("Category not found");
    }
    if (dto.productId) {
      const product = await this.prisma.product.findFirst({
        where: { id: dto.productId, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!product) throw new NotFoundException("Product not found");
    }
    if (dto.getProductId) {
      const product = await this.prisma.product.findFirst({
        where: { id: dto.getProductId, companyId, deletedAt: null },
        select: { id: true },
      });
      if (!product) throw new NotFoundException("Get-product not found");
    }
    if (dto.triggerProductIds && dto.triggerProductIds.length) {
      const ids = dedupeTriggerIds(dto.triggerProductIds);
      const found = await this.prisma.product.findMany({
        where: { id: { in: ids }, companyId, deletedAt: null },
        select: { id: true },
      });
      if (found.length !== ids.length) {
        throw new NotFoundException(
          "Salah satu trigger product tidak ditemukan",
        );
      }
    }
    if (dto.getProductIds && dto.getProductIds.length) {
      const ids = dedupeTriggerIds(dto.getProductIds);
      const found = await this.prisma.product.findMany({
        where: { id: { in: ids }, companyId, deletedAt: null },
        select: { id: true },
      });
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
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    throw new ConflictException("Voucher code sudah digunakan");
  }
}
