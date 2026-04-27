import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  BranchPriceListResponse,
  BranchPriceResponse,
  CreateBranchPriceDto,
  CreateProductUnitDto,
  CreateTierPriceDto,
  ListBranchPricesQueryDto,
  ProductUnitResponse,
  ReplaceBranchPricesDto,
  ReplaceTierPricesDto,
  TierPriceResponse,
  UpdateBranchPriceDto,
  UpdateProductUnitDto,
  UpdateTierPriceDto,
} from "@/contracts";
import { PrismaService } from "../prisma/prisma.service";

const UNIT_SELECT = {
  id: true,
  productId: true,
  name: true,
  conversionQty: true,
  sellingPrice: true,
  purchasePrice: true,
  barcode: true,
  isDefault: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductUnitSelect;

const TIER_SELECT = {
  id: true,
  productId: true,
  minQty: true,
  price: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductTierPriceSelect;

const BRANCH_PRICE_SELECT = {
  id: true,
  branchId: true,
  productId: true,
  sellingPrice: true,
  purchasePrice: true,
  createdAt: true,
  updatedAt: true,
  branch: { select: { id: true, name: true, code: true } },
  product: { select: { id: true, code: true, name: true } },
} satisfies Prisma.BranchProductPriceSelect;

type RawUnit = Prisma.ProductUnitGetPayload<{ select: typeof UNIT_SELECT }>;
type RawTier = Prisma.ProductTierPriceGetPayload<{
  select: typeof TIER_SELECT;
}>;
type RawBranchPrice = Prisma.BranchProductPriceGetPayload<{
  select: typeof BRANCH_PRICE_SELECT;
}>;

@Injectable()
export class ProductExtensionsService {
  constructor(private readonly prisma: PrismaService) {}

  // ============================================================
  // PRODUCT UNITS
  // ============================================================

  async listUnits(
    companyId: string,
    productId: string,
  ): Promise<ProductUnitResponse[]> {
    await this.assertProduct(companyId, productId);
    const rows = await this.prisma.productUnit.findMany({
      where: { productId },
      select: UNIT_SELECT,
      orderBy: { sortOrder: "asc" },
    });
    return rows.map(toUnitResponse);
  }

  async createUnit(
    companyId: string,
    productId: string,
    dto: CreateProductUnitDto,
  ): Promise<ProductUnitResponse> {
    await this.assertProduct(companyId, productId);
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        if (dto.isDefault) {
          await tx.productUnit.updateMany({
            where: { productId, isDefault: true },
            data: { isDefault: false },
          });
        }
        return tx.productUnit.create({
          data: {
            productId,
            name: dto.name,
            conversionQty: dto.conversionQty,
            sellingPrice: dto.sellingPrice,
            purchasePrice: dto.purchasePrice ?? null,
            barcode: dto.barcode ?? null,
            isDefault: dto.isDefault ?? false,
            sortOrder: dto.sortOrder ?? 0,
          },
          select: UNIT_SELECT,
        });
      });
      return toUnitResponse(created);
    } catch (err) {
      throwOnUnitDup(err);
      throw err;
    }
  }

  async updateUnit(
    companyId: string,
    productId: string,
    unitId: string,
    dto: UpdateProductUnitDto,
  ): Promise<ProductUnitResponse> {
    await this.assertProduct(companyId, productId);
    const existing = await this.prisma.productUnit.findFirst({
      where: { id: unitId, productId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Unit produk tidak ditemukan");

    const data: Prisma.ProductUnitUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.conversionQty !== undefined) data.conversionQty = dto.conversionQty;
    if (dto.sellingPrice !== undefined) data.sellingPrice = dto.sellingPrice;
    if (dto.purchasePrice !== undefined) data.purchasePrice = dto.purchasePrice;
    if (dto.barcode !== undefined) data.barcode = dto.barcode;
    if (dto.isDefault !== undefined) data.isDefault = dto.isDefault;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        if (dto.isDefault === true) {
          await tx.productUnit.updateMany({
            where: { productId, isDefault: true, NOT: { id: unitId } },
            data: { isDefault: false },
          });
        }
        return tx.productUnit.update({
          where: { id: unitId },
          data,
          select: UNIT_SELECT,
        });
      });
      return toUnitResponse(updated);
    } catch (err) {
      throwOnUnitDup(err);
      throw err;
    }
  }

  async deleteUnit(
    companyId: string,
    productId: string,
    unitId: string,
  ): Promise<{ success: true }> {
    await this.assertProduct(companyId, productId);
    const existing = await this.prisma.productUnit.findFirst({
      where: { id: unitId, productId },
      select: { id: true, isDefault: true },
    });
    if (!existing) throw new NotFoundException("Unit produk tidak ditemukan");

    if (existing.isDefault) {
      const otherCount = await this.prisma.productUnit.count({
        where: { productId, NOT: { id: unitId } },
      });
      if (otherCount > 0) {
        throw new BadRequestException(
          "Tetapkan unit lain sebagai default sebelum menghapus",
        );
      }
    }

    await this.prisma.productUnit.delete({ where: { id: unitId } });
    return { success: true };
  }

  // ============================================================
  // PRODUCT TIER PRICES
  // ============================================================

  async listTierPrices(
    companyId: string,
    productId: string,
  ): Promise<TierPriceResponse[]> {
    await this.assertProduct(companyId, productId);
    const rows = await this.prisma.productTierPrice.findMany({
      where: { productId },
      select: TIER_SELECT,
      orderBy: { minQty: "asc" },
    });
    return rows.map(toTierResponse);
  }

  async createTierPrice(
    companyId: string,
    productId: string,
    dto: CreateTierPriceDto,
  ): Promise<TierPriceResponse> {
    await this.assertProduct(companyId, productId);
    try {
      const created = await this.prisma.productTierPrice.create({
        data: {
          productId,
          minQty: dto.minQty,
          price: dto.price,
        },
        select: TIER_SELECT,
      });
      return toTierResponse(created);
    } catch (err) {
      throwOnTierDup(err);
      throw err;
    }
  }

  async updateTierPrice(
    companyId: string,
    productId: string,
    tierId: string,
    dto: UpdateTierPriceDto,
  ): Promise<TierPriceResponse> {
    await this.assertProduct(companyId, productId);
    const existing = await this.prisma.productTierPrice.findFirst({
      where: { id: tierId, productId },
      select: { id: true },
    });
    if (!existing)
      throw new NotFoundException("Tier price tidak ditemukan");

    const data: Prisma.ProductTierPriceUpdateInput = {};
    if (dto.minQty !== undefined) data.minQty = dto.minQty;
    if (dto.price !== undefined) data.price = dto.price;

    try {
      const updated = await this.prisma.productTierPrice.update({
        where: { id: tierId },
        data,
        select: TIER_SELECT,
      });
      return toTierResponse(updated);
    } catch (err) {
      throwOnTierDup(err);
      throw err;
    }
  }

  async deleteTierPrice(
    companyId: string,
    productId: string,
    tierId: string,
  ): Promise<{ success: true }> {
    await this.assertProduct(companyId, productId);
    const existing = await this.prisma.productTierPrice.findFirst({
      where: { id: tierId, productId },
      select: { id: true },
    });
    if (!existing)
      throw new NotFoundException("Tier price tidak ditemukan");
    await this.prisma.productTierPrice.delete({ where: { id: tierId } });
    return { success: true };
  }

  async replaceTierPrices(
    companyId: string,
    productId: string,
    dto: ReplaceTierPricesDto,
  ): Promise<TierPriceResponse[]> {
    await this.assertProduct(companyId, productId);

    const seen = new Set<number>();
    for (const item of dto.items) {
      if (seen.has(item.minQty)) {
        throw new ConflictException(
          "Tidak boleh ada minQty yang sama dalam satu produk",
        );
      }
      seen.add(item.minQty);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.productTierPrice.deleteMany({ where: { productId } });
      if (dto.items.length > 0) {
        await tx.productTierPrice.createMany({
          data: dto.items.map((i) => ({
            productId,
            minQty: i.minQty,
            price: i.price,
          })),
        });
      }
    });

    const rows = await this.prisma.productTierPrice.findMany({
      where: { productId },
      select: TIER_SELECT,
      orderBy: { minQty: "asc" },
    });
    return rows.map(toTierResponse);
  }

  // ============================================================
  // BRANCH PRODUCT PRICES
  // ============================================================

  async listBranchPrices(
    companyId: string,
    query: ListBranchPricesQueryDto,
  ): Promise<BranchPriceListResponse> {
    const { branchId, productId, search, page, perPage } = query;

    const where: Prisma.BranchProductPriceWhereInput = {
      product: { companyId },
    };
    if (branchId) where.branchId = branchId;
    if (productId) where.productId = productId;
    if (search) {
      where.product = {
        companyId,
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { code: { contains: search, mode: "insensitive" } },
        ],
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.branchProductPrice.findMany({
        where,
        select: BRANCH_PRICE_SELECT,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.branchProductPrice.count({ where }),
    ]);

    return {
      items: rows.map(toBranchPriceResponse),
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async listBranchPricesForProduct(
    companyId: string,
    productId: string,
  ): Promise<BranchPriceResponse[]> {
    await this.assertProduct(companyId, productId);
    const rows = await this.prisma.branchProductPrice.findMany({
      where: { productId },
      select: BRANCH_PRICE_SELECT,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toBranchPriceResponse);
  }

  async createBranchPrice(
    companyId: string,
    productId: string,
    dto: CreateBranchPriceDto,
  ): Promise<BranchPriceResponse> {
    await this.assertProduct(companyId, productId);
    await this.assertBranch(companyId, dto.branchId);
    try {
      const created = await this.prisma.branchProductPrice.create({
        data: {
          productId,
          branchId: dto.branchId,
          sellingPrice: dto.sellingPrice,
          purchasePrice: dto.purchasePrice ?? null,
        },
        select: BRANCH_PRICE_SELECT,
      });
      return toBranchPriceResponse(created);
    } catch (err) {
      throwOnBranchPriceDup(err);
      throw err;
    }
  }

  async updateBranchPrice(
    companyId: string,
    productId: string,
    id: string,
    dto: UpdateBranchPriceDto,
  ): Promise<BranchPriceResponse> {
    await this.assertProduct(companyId, productId);
    const existing = await this.prisma.branchProductPrice.findFirst({
      where: { id, productId },
      select: { id: true },
    });
    if (!existing)
      throw new NotFoundException("Harga cabang tidak ditemukan");

    const data: Prisma.BranchProductPriceUpdateInput = {};
    if (dto.sellingPrice !== undefined) data.sellingPrice = dto.sellingPrice;
    if (dto.purchasePrice !== undefined) data.purchasePrice = dto.purchasePrice;

    const updated = await this.prisma.branchProductPrice.update({
      where: { id },
      data,
      select: BRANCH_PRICE_SELECT,
    });
    return toBranchPriceResponse(updated);
  }

  async deleteBranchPrice(
    companyId: string,
    productId: string,
    id: string,
  ): Promise<{ success: true }> {
    await this.assertProduct(companyId, productId);
    const existing = await this.prisma.branchProductPrice.findFirst({
      where: { id, productId },
      select: { id: true },
    });
    if (!existing)
      throw new NotFoundException("Harga cabang tidak ditemukan");
    await this.prisma.branchProductPrice.delete({ where: { id } });
    return { success: true };
  }

  async replaceBranchPrices(
    companyId: string,
    productId: string,
    dto: ReplaceBranchPricesDto,
  ): Promise<BranchPriceResponse[]> {
    await this.assertProduct(companyId, productId);

    if (dto.items.length > 0) {
      const branchIds = dto.items.map((i) => i.branchId);
      const seen = new Set<string>();
      for (const id of branchIds) {
        if (seen.has(id)) {
          throw new ConflictException(
            "Tidak boleh ada cabang yang sama dalam satu produk",
          );
        }
        seen.add(id);
      }
      const branches = await this.prisma.branch.findMany({
        where: { id: { in: branchIds }, companyId },
        select: { id: true },
      });
      if (branches.length !== seen.size) {
        throw new NotFoundException("Salah satu cabang tidak ditemukan");
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.branchProductPrice.deleteMany({ where: { productId } });
      if (dto.items.length > 0) {
        await tx.branchProductPrice.createMany({
          data: dto.items.map((i) => ({
            productId,
            branchId: i.branchId,
            sellingPrice: i.sellingPrice,
            purchasePrice: i.purchasePrice ?? null,
          })),
        });
      }
    });

    const rows = await this.prisma.branchProductPrice.findMany({
      where: { productId },
      select: BRANCH_PRICE_SELECT,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toBranchPriceResponse);
  }

  // ============================================================
  // HELPERS
  // ============================================================

  private async assertProduct(
    companyId: string,
    productId: string,
  ): Promise<void> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!product) throw new NotFoundException("Produk tidak ditemukan");
  }

  private async assertBranch(
    companyId: string,
    branchId: string,
  ): Promise<void> {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException("Cabang tidak ditemukan");
  }
}

// ============================================================
// MAPPERS
// ============================================================

function toUnitResponse(u: RawUnit): ProductUnitResponse {
  return {
    id: u.id,
    productId: u.productId,
    name: u.name,
    conversionQty: u.conversionQty,
    sellingPrice: u.sellingPrice,
    purchasePrice: u.purchasePrice,
    barcode: u.barcode,
    isDefault: u.isDefault,
    sortOrder: u.sortOrder,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  };
}

function toTierResponse(t: RawTier): TierPriceResponse {
  return {
    id: t.id,
    productId: t.productId,
    minQty: t.minQty,
    price: t.price,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

function toBranchPriceResponse(b: RawBranchPrice): BranchPriceResponse {
  return {
    id: b.id,
    branchId: b.branchId,
    productId: b.productId,
    sellingPrice: b.sellingPrice,
    purchasePrice: b.purchasePrice,
    branch: b.branch
      ? { id: b.branch.id, name: b.branch.name, code: b.branch.code }
      : null,
    product: b.product
      ? { id: b.product.id, code: b.product.code, name: b.product.name }
      : null,
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

// ============================================================
// ERROR HANDLERS
// ============================================================

function throwOnUnitDup(err: unknown): void {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    throw new ConflictException("Nama unit sudah dipakai produk ini");
  }
}

function throwOnTierDup(err: unknown): void {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    throw new ConflictException(
      "Tier price dengan minQty tersebut sudah ada untuk produk ini",
    );
  }
}

function throwOnBranchPriceDup(err: unknown): void {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    throw new ConflictException(
      "Harga untuk cabang ini sudah ditetapkan pada produk tersebut",
    );
  }
}
