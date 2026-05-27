import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { throwIfUniqueConstraint } from "@/common/utils/prisma-errors";
import { AssertService } from "@/common/assert/assert.service";
import type {
  CreateProductUnitDto,
  ProductUnitResponse,
  UpdateProductUnitDto,
} from "./dto/product-extensions.dto";
import { PrismaService } from "@/modules/prisma/prisma.service";
import {
  ProductExtensionsRepository,
  type RawUnit,
} from "./product-extensions.repository";

@Injectable()
export class ProductUnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: ProductExtensionsRepository,
    private readonly assert: AssertService,
  ) {}

  async listUnits(
    companyId: string,
    productId: string,
  ): Promise<ProductUnitResponse[]> {
    await this.assert.product(companyId, productId);
    const rows = await this.repo.findManyUnits(productId);
    return rows.map(toUnitResponse);
  }

  async createUnit(
    companyId: string,
    productId: string,
    dto: CreateProductUnitDto,
  ): Promise<ProductUnitResponse> {
    await this.assert.product(companyId, productId);
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
          select: {
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
          },
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
    await this.assert.product(companyId, productId);
    const existing = await this.repo.findUnit(unitId, productId);
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
          select: {
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
          },
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
    await this.assert.product(companyId, productId);
    const existing = await this.repo.findUnitWithDefault(unitId, productId);
    if (!existing) throw new NotFoundException("Unit produk tidak ditemukan");

    if (existing.isDefault) {
      const otherCount = await this.repo.countOtherUnits(productId, unitId);
      if (otherCount > 0) {
        throw new BadRequestException(
          "Tetapkan unit lain sebagai default sebelum menghapus",
        );
      }
    }

    await this.repo.deleteUnit(unitId);
    return { success: true };
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

// ============================================================
// ERROR HANDLERS
// ============================================================

function throwOnUnitDup(err: unknown): void {
  throwIfUniqueConstraint(err, "Nama unit sudah dipakai produk ini");
}
