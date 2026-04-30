import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateProductDto,
  ListProductsQueryDto,
  ProductListResponse,
  ProductResponse,
  UpdateProductDto,
} from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";
import { PRODUCT_SELECT, toProductResponse } from "./products.shared";

@Injectable()
export class ProductsCrudService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    companyId: string,
    query: ListProductsQueryDto,
  ): Promise<ProductListResponse> {
    const {
      search,
      categoryId,
      brandId,
      supplierId,
      isActive,
      page,
      perPage,
      sortBy,
      sortDir,
    } = query;
    const where: Prisma.ProductWhereInput = { companyId, deletedAt: null };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { code: { contains: search, mode: "insensitive" } },
        { barcode: { contains: search, mode: "insensitive" } },
      ];
    }
    if (categoryId) where.categoryId = categoryId;
    if (brandId) where.brandId = brandId;
    if (supplierId) where.supplierId = supplierId;
    if (isActive !== undefined) where.isActive = isActive;

    const dir: "asc" | "desc" = sortDir ?? "asc";
    let orderBy: Prisma.ProductOrderByWithRelationInput = {
      createdAt: "desc",
    };
    if (sortBy) {
      switch (sortBy) {
        case "category":
          orderBy = { category: { name: dir } };
          break;
        case "name":
        case "code":
        case "purchasePrice":
        case "sellingPrice":
        case "stock":
        case "createdAt":
          orderBy = { [sortBy]: dir } as Prisma.ProductOrderByWithRelationInput;
          break;
      }
    }

    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        select: PRODUCT_SELECT,
        orderBy,
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      products: rows.map(toProductResponse),
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async findById(companyId: string, id: string): Promise<ProductResponse> {
    const product = await this.prisma.product.findFirst({
      where: { id, companyId, deletedAt: null },
      select: PRODUCT_SELECT,
    });
    if (!product) throw new NotFoundException("Product not found");
    return toProductResponse(product);
  }
  private async syncProductModifierGroups(
    companyId: string,
    productId: string,
    modifierGroupIds: string[],
  ): Promise<void> {
    if (modifierGroupIds.length > 0) {
      const owned = await this.prisma.modifierGroup.findMany({
        where: { id: { in: modifierGroupIds }, companyId },
        select: { id: true },
      });
      if (owned.length !== modifierGroupIds.length) {
        throw new BadRequestException(
          "One or more modifier groups invalid",
        );
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.productModifierGroup.deleteMany({ where: { productId } });
      if (modifierGroupIds.length > 0) {
        await tx.productModifierGroup.createMany({
          data: modifierGroupIds.map((modifierGroupId, idx) => ({
            productId,
            modifierGroupId,
            sortOrder: idx,
          })),
        });
      }
    });
  }

  private async generateProductCode(companyId: string): Promise<string> {
    // Try a few times to avoid collisions (P2002 from unique [companyId, code]).
    for (let i = 0; i < 5; i++) {
      const candidate = `PRD-${Date.now().toString(36).toUpperCase().slice(-5)}${Math.random().toString(36).toUpperCase().slice(-3)}`;
      const exists = await this.prisma.product.findFirst({
        where: { companyId, code: candidate },
        select: { id: true },
      });
      if (!exists) return candidate;
    }
    return `PRD-${Date.now().toString(36).toUpperCase()}`;
  }
  async create(
    companyId: string,
    dto: CreateProductDto,
  ): Promise<ProductResponse> {
    try {
      const code = dto.code?.trim()
        ? dto.code.trim()
        : await this.generateProductCode(companyId);
      const created = await this.prisma.product.create({
        data: {
          code,
          name: dto.name,
          categoryId: dto.categoryId,
          brandId: dto.brandId ?? null,
          supplierId: dto.supplierId ?? null,
          companyId,
          purchasePrice: dto.purchasePrice,
          sellingPrice: dto.sellingPrice,
          stock: dto.stock ?? 0,
          minStock: dto.minStock ?? 5,
          barcode: dto.barcode ?? null,
          unit: dto.unit ?? "pcs",
          isActive: dto.isActive ?? true,
          description: dto.description ?? null,
          imageUrl: dto.imageUrl ?? null,
        },
        select: PRODUCT_SELECT,
      });
      if (dto.modifierGroupIds !== undefined) {
        await this.syncProductModifierGroups(
          companyId,
          created.id,
          dto.modifierGroupIds,
        );
      }
      return toProductResponse(created);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new ConflictException("Kode atau barcode produk sudah digunakan");
      }
      throw err;
    }
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateProductDto,
  ): Promise<ProductResponse> {
    const existing = await this.prisma.product.findFirst({
      where: { id, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Product not found");

    const data: Prisma.ProductUpdateInput = {};
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.categoryId !== undefined) {
      data.category = { connect: { id: dto.categoryId } };
    }
    if (dto.brandId !== undefined) {
      data.brand = dto.brandId
        ? { connect: { id: dto.brandId } }
        : { disconnect: true };
    }
    if (dto.supplierId !== undefined) {
      data.supplier = dto.supplierId
        ? { connect: { id: dto.supplierId } }
        : { disconnect: true };
    }
    if (dto.purchasePrice !== undefined) data.purchasePrice = dto.purchasePrice;
    if (dto.sellingPrice !== undefined) data.sellingPrice = dto.sellingPrice;
    if (dto.stock !== undefined) data.stock = dto.stock;
    if (dto.minStock !== undefined) data.minStock = dto.minStock;
    if (dto.barcode !== undefined) data.barcode = dto.barcode;
    if (dto.unit !== undefined) data.unit = dto.unit;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.imageUrl !== undefined) data.imageUrl = dto.imageUrl;

    try {
      const updated = await this.prisma.product.update({
        where: { id },
        data,
        select: PRODUCT_SELECT,
      });
      if (dto.modifierGroupIds !== undefined) {
        await this.syncProductModifierGroups(
          companyId,
          id,
          dto.modifierGroupIds,
        );
      }
      return toProductResponse(updated);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        throw new ConflictException("Kode atau barcode produk sudah digunakan");
      }
      throw err;
    }
  }

  async softDelete(
    companyId: string,
    id: string,
  ): Promise<{ success: true }> {
    const existing = await this.prisma.product.findFirst({
      where: { id, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Product not found");

    await this.prisma.product.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    return { success: true };
  }
}
