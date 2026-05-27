import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { throwIfUniqueConstraint } from "@/common/utils/prisma-errors";
import { AssertService } from "@/common/assert/assert.service";
import type {
  BranchPriceListResponse,
  BranchPriceResponse,
  CreateBranchPriceDto,
  CreateTierPriceDto,
  ListBranchPricesQueryDto,
  ReplaceBranchPricesDto,
  ReplaceTierPricesDto,
  TierPriceResponse,
  UpdateBranchPriceDto,
  UpdateTierPriceDto,
} from "./dto/product-extensions.dto";
import { paginate } from "@/common/utils/pagination";
import { PrismaService } from "@/modules/prisma/prisma.service";
import {
  ProductExtensionsRepository,
  type RawTier,
  type RawBranchPrice,
} from "./product-extensions.repository";

@Injectable()
export class ProductPricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: ProductExtensionsRepository,
    private readonly assert: AssertService,
  ) {}

  // ============================================================
  // PRODUCT TIER PRICES
  // ============================================================

  async listTierPrices(
    companyId: string,
    productId: string,
  ): Promise<TierPriceResponse[]> {
    await this.assert.product(companyId, productId);
    const rows = await this.repo.findManyTierPrices(productId);
    return rows.map(toTierResponse);
  }

  async createTierPrice(
    companyId: string,
    productId: string,
    dto: CreateTierPriceDto,
  ): Promise<TierPriceResponse> {
    await this.assert.product(companyId, productId);
    try {
      const created = await this.repo.createTierPrice(productId, {
        minQty: dto.minQty,
        price: dto.price,
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
    await this.assert.product(companyId, productId);
    const existing = await this.repo.findTierPrice(tierId, productId);
    if (!existing)
      throw new NotFoundException("Tier price tidak ditemukan");

    const data: Prisma.ProductTierPriceUpdateInput = {};
    if (dto.minQty !== undefined) data.minQty = dto.minQty;
    if (dto.price !== undefined) data.price = dto.price;

    try {
      const updated = await this.repo.updateTierPrice(tierId, data);
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
    await this.assert.product(companyId, productId);
    const existing = await this.repo.findTierPrice(tierId, productId);
    if (!existing)
      throw new NotFoundException("Tier price tidak ditemukan");
    await this.repo.deleteTierPrice(tierId);
    return { success: true };
  }

  async replaceTierPrices(
    companyId: string,
    productId: string,
    dto: ReplaceTierPricesDto,
  ): Promise<TierPriceResponse[]> {
    await this.assert.product(companyId, productId);

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

    const rows = await this.repo.findManyTierPrices(productId);
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
    };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { code: { contains: search, mode: "insensitive" } },
        { barcode: { contains: search, mode: "insensitive" } },
      ];
    }

    const [products, total] = await Promise.all([
      this.repo.findProductsWithBranchPrices(
        where,
        branchId,
        (page - 1) * perPage,
        perPage,
      ),
      this.repo.countProducts(where),
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
      this.repo.findManyBranchPrices(where, (page - 1) * perPage, perPage),
      this.repo.countBranchPrices(where),
    ]);

    return paginate(rows.map(toBranchPriceResponse), total, page, perPage);
  }

  async listBranchPricesForProduct(
    companyId: string,
    productId: string,
  ): Promise<BranchPriceResponse[]> {
    await this.assert.product(companyId, productId);
    const rows = await this.repo.findManyBranchPricesForProduct(productId);
    return rows.map(toBranchPriceResponse);
  }

  async createBranchPrice(
    companyId: string,
    productId: string,
    dto: CreateBranchPriceDto,
  ): Promise<BranchPriceResponse> {
    await this.assert.product(companyId, productId);
    await this.assert.branch(companyId, dto.branchId);
    try {
      const created = await this.repo.createBranchPrice({
        productId,
        branchId: dto.branchId,
        sellingPrice: dto.sellingPrice,
        purchasePrice: dto.purchasePrice ?? null,
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
    await this.assert.product(companyId, productId);
    const existing = await this.repo.findBranchPrice(id, productId);
    if (!existing)
      throw new NotFoundException("Harga cabang tidak ditemukan");

    const data: Prisma.BranchProductPriceUpdateInput = {};
    if (dto.sellingPrice !== undefined) data.sellingPrice = dto.sellingPrice;
    if (dto.purchasePrice !== undefined) data.purchasePrice = dto.purchasePrice;

    const updated = await this.repo.updateBranchPrice(id, data);
    return toBranchPriceResponse(updated);
  }

  async deleteBranchPrice(
    companyId: string,
    productId: string,
    id: string,
  ): Promise<{ success: true }> {
    await this.assert.product(companyId, productId);
    const existing = await this.repo.findBranchPrice(id, productId);
    if (!existing)
      throw new NotFoundException("Harga cabang tidak ditemukan");
    await this.repo.deleteBranchPrice(id);
    return { success: true };
  }

  async replaceBranchPrices(
    companyId: string,
    productId: string,
    dto: ReplaceBranchPricesDto,
  ): Promise<BranchPriceResponse[]> {
    await this.assert.product(companyId, productId);

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
      const branches = await this.repo.findBranchIds(branchIds, companyId);
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

    const rows = await this.repo.findManyBranchPricesForProduct(productId);
    return rows.map(toBranchPriceResponse);
  }
}

// ============================================================
// MAPPERS
// ============================================================

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

function throwOnTierDup(err: unknown): void {
  throwIfUniqueConstraint(err, "Tier price dengan minQty tersebut sudah ada untuk produk ini");
}

function throwOnBranchPriceDup(err: unknown): void {
  throwIfUniqueConstraint(err, "Harga untuk cabang ini sudah ditetapkan pada produk tersebut");
}
