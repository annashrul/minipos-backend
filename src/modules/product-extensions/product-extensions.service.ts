import {
  BadRequestException,
  Injectable,
} from "@nestjs/common";
import { AssertService } from "@/common/assert/assert.service";
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
import { PrismaService } from "@/modules/prisma/prisma.service";
import { ProductExtensionsRepository } from "./product-extensions.repository";
import { ProductUnitsService } from "./product-units.service";
import { ProductPricingService } from "./product-pricing.service";

@Injectable()
export class ProductExtensionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: ProductExtensionsRepository,
    private readonly assert: AssertService,
    private readonly units: ProductUnitsService,
    private readonly pricing: ProductPricingService,
  ) {}

  // ============================================================
  // PRODUCT UNITS (delegated)
  // ============================================================

  listUnits(
    companyId: string,
    productId: string,
  ): Promise<ProductUnitResponse[]> {
    return this.units.listUnits(companyId, productId);
  }

  createUnit(
    companyId: string,
    productId: string,
    dto: CreateProductUnitDto,
  ): Promise<ProductUnitResponse> {
    return this.units.createUnit(companyId, productId, dto);
  }

  updateUnit(
    companyId: string,
    productId: string,
    unitId: string,
    dto: UpdateProductUnitDto,
  ): Promise<ProductUnitResponse> {
    return this.units.updateUnit(companyId, productId, unitId, dto);
  }

  deleteUnit(
    companyId: string,
    productId: string,
    unitId: string,
  ): Promise<{ success: true }> {
    return this.units.deleteUnit(companyId, productId, unitId);
  }

  // ============================================================
  // PRODUCT TIER PRICES (delegated)
  // ============================================================

  listTierPrices(
    companyId: string,
    productId: string,
  ): Promise<TierPriceResponse[]> {
    return this.pricing.listTierPrices(companyId, productId);
  }

  createTierPrice(
    companyId: string,
    productId: string,
    dto: CreateTierPriceDto,
  ): Promise<TierPriceResponse> {
    return this.pricing.createTierPrice(companyId, productId, dto);
  }

  updateTierPrice(
    companyId: string,
    productId: string,
    tierId: string,
    dto: UpdateTierPriceDto,
  ): Promise<TierPriceResponse> {
    return this.pricing.updateTierPrice(companyId, productId, tierId, dto);
  }

  deleteTierPrice(
    companyId: string,
    productId: string,
    tierId: string,
  ): Promise<{ success: true }> {
    return this.pricing.deleteTierPrice(companyId, productId, tierId);
  }

  replaceTierPrices(
    companyId: string,
    productId: string,
    dto: ReplaceTierPricesDto,
  ): Promise<TierPriceResponse[]> {
    return this.pricing.replaceTierPrices(companyId, productId, dto);
  }

  // ============================================================
  // BRANCH PRODUCT PRICES (delegated)
  // ============================================================

  productsWithBranchPrices(
    companyId: string,
    query: { branchId: string; search?: string; page?: number; perPage?: number },
  ) {
    return this.pricing.productsWithBranchPrices(companyId, query);
  }

  listBranchPrices(
    companyId: string,
    query: ListBranchPricesQueryDto,
  ): Promise<BranchPriceListResponse> {
    return this.pricing.listBranchPrices(companyId, query);
  }

  listBranchPricesForProduct(
    companyId: string,
    productId: string,
  ): Promise<BranchPriceResponse[]> {
    return this.pricing.listBranchPricesForProduct(companyId, productId);
  }

  createBranchPrice(
    companyId: string,
    productId: string,
    dto: CreateBranchPriceDto,
  ): Promise<BranchPriceResponse> {
    return this.pricing.createBranchPrice(companyId, productId, dto);
  }

  updateBranchPrice(
    companyId: string,
    productId: string,
    id: string,
    dto: UpdateBranchPriceDto,
  ): Promise<BranchPriceResponse> {
    return this.pricing.updateBranchPrice(companyId, productId, id, dto);
  }

  deleteBranchPrice(
    companyId: string,
    productId: string,
    id: string,
  ): Promise<{ success: true }> {
    return this.pricing.deleteBranchPrice(companyId, productId, id);
  }

  replaceBranchPrices(
    companyId: string,
    productId: string,
    dto: ReplaceBranchPricesDto,
  ): Promise<BranchPriceResponse[]> {
    return this.pricing.replaceBranchPrices(companyId, productId, dto);
  }

  // ============================================================
  // PRODUCT VARIANTS (matrix SKU per modifier combination)
  // ============================================================

  async listVariants(
    companyId: string,
    productId: string,
  ): Promise<ProductVariantListResponse> {
    await this.assert.product(companyId, productId);
    const rows = await this.repo.findManyVariants(productId);
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
    await this.assert.product(companyId, productId);
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
    await this.assert.product(companyId, productId);
    const candidates = await this.repo.findActiveVariants(productId);
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
  // PRODUCT BRANCH SKU (Cabang x Satuan x Varian -- single source of truth)
  // ============================================================

  async listBranchSkus(
    companyId: string,
    productId: string,
  ): Promise<ProductBranchSkuListResponse> {
    await this.assert.product(companyId, productId);
    const rows = await this.repo.findManyBranchSkus(productId);
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
    await this.assert.product(companyId, productId);

    // Resolve variantId per item -- kalau optionIds di-pass tapi variantId belum,
    // find-or-create ProductVariant untuk kombinasi tersebut. Ini menghilangkan
    // kebutuhan tab Varian terpisah -- variant otomatis di-upsert saat save SKU.
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
      // representative per branch -- sumber tunggal kebenaran ada di matrix.
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
        // Pilih variant pertama yang ditemui per branch -- single value per
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
    await this.assert.product(companyId, productId);
    const sku = await this.repo.findBranchSku(
      productId,
      branchId,
      unitId,
      variantId,
    );
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
}
