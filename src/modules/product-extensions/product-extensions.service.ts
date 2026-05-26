import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { throwIfUniqueConstraint } from "@/common/utils/prisma-errors";
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
} from "./dto/product-extensions.dto";
import type {
  ProductVariantResponse,
  ProductVariantListResponse,
  ReplaceProductVariantsDto,
} from "./dto/product-variants.dto";
import type {
  ProductBranchSkuResponse,
  ProductBranchSkuListResponse,
  ReplaceProductBranchSkusDto,
} from "./dto/product-branch-skus.dto";
import type { PaginatedResponse } from "../../common/types/response";
import { paginate } from "../../common/utils/pagination";
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

  async productsWithBranchPrices(
    companyId: string,
    query: { branchId: string; search?: string; page?: number; perPage?: number },
  ) {
    const { branchId, search, page = 1, perPage = 20 } = query;

    const where: Prisma.ProductWhereInput = {
      companyId,
      isActive: true,
      deletedAt: null,
    };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { code: { contains: search, mode: "insensitive" } },
        { barcode: { contains: search, mode: "insensitive" } },
      ];
    }

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        select: {
          id: true,
          code: true,
          name: true,
          sellingPrice: true,
          purchasePrice: true,
          stock: true,
          unit: true,
          barcode: true,
          imageUrl: true,
          category: { select: { id: true, name: true } },
          branchPrices: {
            where: { branchId },
            select: {
              id: true,
              sellingPrice: true,
              purchasePrice: true,
            },
            take: 1,
          },
        },
        orderBy: { name: "asc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.product.count({ where }),
    ]);

    const items = products.map((p) => {
      const bp = p.branchPrices[0] ?? null;
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        sellingPrice: p.sellingPrice,
        purchasePrice: p.purchasePrice,
        stock: p.stock,
        unit: p.unit,
        barcode: p.barcode,
        imageUrl: p.imageUrl,
        category: p.category,
        branchPriceId: bp?.id ?? null,
        branchSellingPrice: bp?.sellingPrice ?? null,
        branchPurchasePrice: bp?.purchasePrice ?? null,
        hasCustomPrice: bp !== null,
      };
    });

    return paginate(items, total, page, perPage);
  }

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
  // PRODUCT VARIANTS (matrix SKU per modifier combination)
  // ============================================================

  async listVariants(
    companyId: string,
    productId: string,
  ): Promise<ProductVariantListResponse> {
    await this.assertProduct(companyId, productId);
    const rows = await this.prisma.productVariant.findMany({
      where: { productId },
      include: { options: { select: { optionId: true } } },
      orderBy: { createdAt: "asc" },
    });
    return {
      variants: rows.map((v) => ({
        id: v.id,
        productId: v.productId,
        priceOverride: v.priceOverride,
        purchasePriceOverride: v.purchasePriceOverride,
        stock: v.stock,
        barcode: v.barcode,
        isActive: v.isActive,
        optionIds: v.options.map((o) => o.optionId),
        createdAt: v.createdAt.toISOString(),
        updatedAt: v.updatedAt.toISOString(),
      })),
    };
  }

  async replaceVariants(
    companyId: string,
    productId: string,
    dto: ReplaceProductVariantsDto,
  ): Promise<ProductVariantListResponse> {
    await this.assertProduct(companyId, productId);
    for (const v of dto.items) {
      if (new Set(v.optionIds).size !== v.optionIds.length) {
        throw new BadRequestException(
          "Tiap variant tidak boleh punya option duplicate",
        );
      }
    }
    await this.prisma.$transaction(async (tx) => {
      const incomingIds = dto.items
        .map((v) => v.id)
        .filter((id): id is string => Boolean(id));
      await tx.productVariant.deleteMany({
        where: {
          productId,
          id: { notIn: incomingIds.length ? incomingIds : ["__none__"] },
        },
      });
      for (const item of dto.items) {
        if (item.id) {
          await tx.productVariant.update({
            where: { id: item.id },
            data: {
              priceOverride: item.priceOverride ?? null,
              purchasePriceOverride: item.purchasePriceOverride ?? null,
              stock: item.stock ?? 0,
              barcode: item.barcode ?? null,
              isActive: item.isActive ?? true,
            },
          });
          await tx.productVariantOption.deleteMany({
            where: { variantId: item.id },
          });
          await tx.productVariantOption.createMany({
            data: item.optionIds.map((optionId) => ({
              variantId: item.id!,
              optionId,
            })),
            skipDuplicates: true,
          });
        } else {
          const created = await tx.productVariant.create({
            data: {
              productId,
              priceOverride: item.priceOverride ?? null,
              purchasePriceOverride: item.purchasePriceOverride ?? null,
              stock: item.stock ?? 0,
              barcode: item.barcode ?? null,
              isActive: item.isActive ?? true,
            },
          });
          await tx.productVariantOption.createMany({
            data: item.optionIds.map((optionId) => ({
              variantId: created.id,
              optionId,
            })),
            skipDuplicates: true,
          });
        }
      }
    });
    return this.listVariants(companyId, productId);
  }

  // Lookup variant by exact set of optionIds.
  async findVariantByOptions(
    companyId: string,
    productId: string,
    optionIds: string[],
  ) {
    if (optionIds.length === 0) return null;
    await this.assertProduct(companyId, productId);
    const candidates = await this.prisma.productVariant.findMany({
      where: { productId, isActive: true },
      include: { options: { select: { optionId: true } } },
    });
    const incoming = new Set(optionIds);
    const match = candidates.find((v) => {
      if (v.options.length !== incoming.size) return false;
      return v.options.every((o) => incoming.has(o.optionId));
    });
    if (!match) return null;
    return {
      id: match.id,
      productId: match.productId,
      priceOverride: match.priceOverride,
      purchasePriceOverride: match.purchasePriceOverride,
      stock: match.stock,
      barcode: match.barcode,
      isActive: match.isActive,
      optionIds: match.options.map((o) => o.optionId),
      createdAt: match.createdAt.toISOString(),
      updatedAt: match.updatedAt.toISOString(),
    };
  }

  // ============================================================
  // PRODUCT BRANCH SKU (Cabang × Satuan × Varian — single source of truth)
  // ============================================================

  async listBranchSkus(
    companyId: string,
    productId: string,
  ): Promise<ProductBranchSkuListResponse> {
    await this.assertProduct(companyId, productId);
    const rows = await this.prisma.productBranchSku.findMany({
      where: { productId },
      orderBy: [{ branchId: "asc" }, { unitId: "asc" }, { variantId: "asc" }],
    });
    return {
      skus: rows.map((s) => ({
        id: s.id,
        productId: s.productId,
        branchId: s.branchId,
        unitId: s.unitId,
        variantId: s.variantId,
        sellingPrice: s.sellingPrice,
        purchasePrice: s.purchasePrice,
        stock: s.stock,
        minStock: s.minStock,
        barcode: s.barcode,
        isActive: s.isActive,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
    };
  }

  // Replace strategy: hapus SKU lama yang tidak ada di payload, update by id,
  // create new tanpa id. Validasi uniqueness per (branchId, unitId, variantId).
  async replaceBranchSkus(
    companyId: string,
    productId: string,
    dto: ReplaceProductBranchSkusDto,
  ): Promise<ProductBranchSkuListResponse> {
    await this.assertProduct(companyId, productId);

    // Resolve variantId per item — kalau optionIds di-pass tapi variantId belum,
    // find-or-create ProductVariant untuk kombinasi tersebut. Ini menghilangkan
    // kebutuhan tab Varian terpisah — variant otomatis di-upsert saat save SKU.
    const resolvedItems = await this.prisma.$transaction(async (tx) => {
      const variantCandidates = await tx.productVariant.findMany({
        where: { productId },
        include: { options: { select: { optionId: true } } },
      });
      const variantIdBySignature = new Map<string, string>(
        variantCandidates.map((v) => [
          v.options.map((o) => o.optionId).sort().join("|"),
          v.id,
        ]),
      );

      const out: typeof dto.items = [];
      for (const item of dto.items) {
        let variantId = item.variantId ?? null;
        if (!variantId && item.optionIds && item.optionIds.length > 0) {
          const sortedIncoming = [...item.optionIds].sort().join("|");
          const cachedId = variantIdBySignature.get(sortedIncoming);
          if (cachedId) {
            variantId = cachedId;
          } else {
            const created = await tx.productVariant.create({
              data: {
                productId,
                isActive: true,
                options: {
                  create: item.optionIds.map((oid) => ({ optionId: oid })),
                },
              },
            });
            variantId = created.id;
            variantIdBySignature.set(sortedIncoming, created.id);
          }
        }
        out.push({ ...item, variantId });
      }
      return out;
    });

    // Validasi: tidak boleh duplikat (branch, unit, variant) dalam payload.
    const seenKeys = new Set<string>();
    for (const item of resolvedItems) {
      const key = `${item.branchId}|${item.unitId ?? ""}|${item.variantId ?? ""}`;
      if (seenKeys.has(key)) {
        throw new BadRequestException(
          "Duplikat: kombinasi cabang/satuan/varian tidak boleh sama",
        );
      }
      seenKeys.add(key);
    }

    await this.prisma.$transaction(async (tx) => {
      const incomingIds = resolvedItems
        .map((v) => v.id)
        .filter((id): id is string => Boolean(id));
      await tx.productBranchSku.deleteMany({
        where: {
          productId,
          id: { notIn: incomingIds.length ? incomingIds : ["__none__"] },
        },
      });
      for (const item of resolvedItems) {
        if (item.id) {
          await tx.productBranchSku.update({
            where: { id: item.id },
            data: {
              branchId: item.branchId,
              unitId: item.unitId ?? null,
              variantId: item.variantId ?? null,
              sellingPrice: item.sellingPrice,
              purchasePrice: item.purchasePrice,
              stock: item.stock ?? 0,
              minStock: item.minStock ?? 5,
              barcode: item.barcode ?? null,
              isActive: item.isActive ?? true,
            },
          });
        } else {
          await tx.productBranchSku.create({
            data: {
              productId,
              branchId: item.branchId,
              unitId: item.unitId ?? null,
              variantId: item.variantId ?? null,
              sellingPrice: item.sellingPrice,
              purchasePrice: item.purchasePrice,
              stock: item.stock ?? 0,
              minStock: item.minStock ?? 5,
              barcode: item.barcode ?? null,
              isActive: item.isActive ?? true,
            },
          });
        }
      }

      // Sync ke tabel legacy (BranchStock + BranchProductPrice) supaya
      // vw_product_branch & list endpoint reflect harga/stok terbaru.
      // Pakai cell base-unit (unitId = unit dengan conversionQty terkecil
      // utk produk multi-unit, atau unitId=null kalau no multi-unit) sebagai
      // representative per branch — sumber tunggal kebenaran ada di matrix.
      const productUnits = await tx.productUnit.findMany({
        where: { productId },
        select: { id: true, conversionQty: true },
        orderBy: { conversionQty: "asc" },
      });
      const baseUnitId = productUnits[0]?.id ?? null;

      const perBranch = new Map<
        string,
        { sellingPrice: number; purchasePrice: number; stock: number; minStock: number }
      >();
      for (const item of resolvedItems) {
        // Pilih hanya cell base-unit (atau cell tanpa unit kalau produk
        // single-unit). Kalau produk multi-unit dan cell bukan base, skip.
        const isBase = baseUnitId
          ? item.unitId === baseUnitId
          : !item.unitId;
        if (!isBase) continue;
        // Pilih variant pertama yang ditemui per branch — single value per
        // branch di tabel legacy (tidak punya breakdown per varian).
        if (perBranch.has(item.branchId)) continue;
        perBranch.set(item.branchId, {
          sellingPrice: item.sellingPrice,
          purchasePrice: item.purchasePrice,
          stock: item.stock ?? 0,
          minStock: item.minStock ?? 5,
        });
      }

      for (const [branchId, vals] of perBranch.entries()) {
        await tx.branchProductPrice.upsert({
          where: { branchId_productId: { branchId, productId } },
          create: {
            branchId,
            productId,
            sellingPrice: vals.sellingPrice,
            purchasePrice: vals.purchasePrice,
          },
          update: {
            sellingPrice: vals.sellingPrice,
            purchasePrice: vals.purchasePrice,
          },
        });
        await tx.branchStock.upsert({
          where: { branchId_productId: { branchId, productId } },
          create: {
            branchId,
            productId,
            quantity: vals.stock,
            minStock: vals.minStock,
          },
          update: {
            quantity: vals.stock,
            minStock: vals.minStock,
          },
        });
      }

      // Sync Product.stock juga = total quantity dari semua BranchStock
      // (avoid double-count antar satuan). Ini yang dipakai list endpoint
      // global view.
      const totalStock = [...perBranch.values()].reduce(
        (sum, v) => sum + v.stock,
        0,
      );
      // Pilih rep cell pertama untuk Product.{purchasePrice,sellingPrice}.
      const repCell = [...perBranch.values()][0];
      await tx.product.update({
        where: { id: productId },
        data: {
          stock: totalStock,
          ...(repCell
            ? {
                purchasePrice: repCell.purchasePrice,
                sellingPrice: repCell.sellingPrice,
                minStock: repCell.minStock,
              }
            : {}),
        },
      });
    });

    return this.listBranchSkus(companyId, productId);
  }

  // Lookup SKU exact match. Dipakai POS untuk resolve harga & stok saat
  // customer memilih (cabang, satuan, varian).
  async findBranchSku(
    companyId: string,
    productId: string,
    branchId: string,
    unitId: string | null,
    variantId: string | null,
  ): Promise<ProductBranchSkuResponse | null> {
    await this.assertProduct(companyId, productId);
    const sku = await this.prisma.productBranchSku.findFirst({
      where: {
        productId,
        branchId,
        unitId: unitId ?? null,
        variantId: variantId ?? null,
        isActive: true,
      },
    });
    if (!sku) return null;
    return {
      id: sku.id,
      productId: sku.productId,
      branchId: sku.branchId,
      unitId: sku.unitId,
      variantId: sku.variantId,
      sellingPrice: sku.sellingPrice,
      purchasePrice: sku.purchasePrice,
      stock: sku.stock,
      minStock: sku.minStock,
      barcode: sku.barcode,
      isActive: sku.isActive,
      createdAt: sku.createdAt.toISOString(),
      updatedAt: sku.updatedAt.toISOString(),
    };
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
  throwIfUniqueConstraint(err, "Nama unit sudah dipakai produk ini");
}

function throwOnTierDup(err: unknown): void {
  throwIfUniqueConstraint(err, "Tier price dengan minQty tersebut sudah ada untuk produk ini");
}

function throwOnBranchPriceDup(err: unknown): void {
  throwIfUniqueConstraint(err, "Harga untuk cabang ini sudah ditetapkan pada produk tersebut");
}

