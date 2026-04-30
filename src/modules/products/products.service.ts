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
import { PrismaService } from "../prisma/prisma.service";

const PRODUCT_SELECT = {
  id: true,
  code: true,
  name: true,
  categoryId: true,
  category: { select: { id: true, name: true } },
  brandId: true,
  brand: { select: { id: true, name: true } },
  supplierId: true,
  supplier: { select: { id: true, name: true } },
  purchasePrice: true,
  sellingPrice: true,
  stock: true,
  minStock: true,
  barcode: true,
  unit: true,
  isActive: true,
  description: true,
  imageUrl: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ProductSelect;

type RawProduct = Prisma.ProductGetPayload<{ select: typeof PRODUCT_SELECT }>;

@Injectable()
export class ProductsService {
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

  async stats(
    companyId: string,
    branchId?: string,
  ): Promise<{
    total: number;
    active: number;
    lowStock: number;
    outOfStock: number;
  }> {
    if (branchId) {
      const result = await this.prisma.$queryRaw<
        [{
          total: bigint;
          active: bigint;
          low_stock: bigint;
          out_of_stock: bigint;
        }]
      >`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE p."isActive" = true)::int AS active,
               COUNT(*) FILTER (WHERE COALESCE(bs.quantity, 0) > 0 AND COALESCE(bs.quantity, 0) <= 10)::int AS low_stock,
               COUNT(*) FILTER (WHERE COALESCE(bs.quantity, 0) = 0)::int AS out_of_stock
          FROM products p
          LEFT JOIN branch_stocks bs ON bs."productId" = p.id AND bs."branchId" = ${branchId}
          WHERE p."companyId" = ${companyId} AND p."deletedAt" IS NULL
      `;
      const r = result[0];
      return {
        total: Number(r.total),
        active: Number(r.active),
        lowStock: Number(r.low_stock),
        outOfStock: Number(r.out_of_stock),
      };
    }
    const result = await this.prisma.$queryRaw<
      [{
        total: bigint;
        active: bigint;
        low_stock: bigint;
        out_of_stock: bigint;
      }]
    >`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE "isActive" = true)::int AS active,
             COUNT(*) FILTER (WHERE stock > 0 AND stock <= 10)::int AS low_stock,
             COUNT(*) FILTER (WHERE stock = 0)::int AS out_of_stock
        FROM products
        WHERE "companyId" = ${companyId} AND "deletedAt" IS NULL
    `;
    const r = result[0];
    return {
      total: Number(r.total),
      active: Number(r.active),
      lowStock: Number(r.low_stock),
      outOfStock: Number(r.out_of_stock),
    };
  }

  async findByBarcode(
    companyId: string,
    barcode: string,
    branchId?: string,
  ): Promise<unknown | null> {
    const product = await this.prisma.product.findFirst({
      where: {
        companyId,
        deletedAt: null,
        OR: [{ code: barcode }, { units: { some: { barcode } } }],
      },
      include: {
        category: { select: { name: true } },
        units: true,
      },
    });
    if (!product) return null;
    if (branchId) {
      const bs = await this.prisma.branchStock.findFirst({
        where: { productId: product.id, branchId },
        select: { quantity: true },
      });
      return { ...product, branchStock: bs?.quantity ?? 0 };
    }
    return product;
  }

  async topSelling(
    companyId: string,
    limit = 8,
  ): Promise<unknown[]> {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const items = await this.prisma.transactionItem.groupBy({
      by: ["productId"],
      where: {
        transaction: {
          status: "COMPLETED",
          createdAt: { gte: since },
          user: { companyId },
        },
      },
      _sum: { quantity: true, subtotal: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: limit,
    });
    if (items.length === 0) return [];
    const products = await this.prisma.product.findMany({
      where: { id: { in: items.map((i) => i.productId) }, companyId },
      select: {
        id: true,
        code: true,
        name: true,
        sellingPrice: true,
        stock: true,
        unit: true,
        imageUrl: true,
      },
    });
    const map = new Map(products.map((p) => [p.id, p]));
    return items
      .map((it) => {
        const p = map.get(it.productId);
        if (!p) return null;
        return {
          ...p,
          totalQty: it._sum.quantity ?? 0,
          totalRevenue: it._sum.subtotal ?? 0,
        };
      })
      .filter(Boolean);
  }

  async byCategory(
    companyId: string,
    categoryId: string,
  ): Promise<unknown[]> {
    return this.prisma.product.findMany({
      where: {
        companyId,
        categoryId,
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        code: true,
        name: true,
        sellingPrice: true,
        stock: true,
        unit: true,
        imageUrl: true,
      },
      orderBy: { name: "asc" },
    });
  }

  async branchView(
    companyId: string,
    params: {
      branchId?: string;
      search?: string;
      categoryId?: string;
      brandId?: string;
      isActive?: boolean;
      stockStatus?: string;
      limit?: number;
      offset?: number;
      onlyWithStock?: boolean;
      // POS mode: when branchId is set, only include products that were
      // explicitly assigned to that branch (have BranchStock or BranchPrice).
      // Tanpa flag ini, view CROSS JOIN-nya membuat semua produk company
      // muncul di tiap branch via fallback ke stock global — yang user lihat
      // sebagai "POS menampilkan semua produk".
      restrictToBranchAssigned?: boolean;
    },
  ): Promise<{ rows: unknown[]; total: number }> {
    const {
      branchId,
      search,
      categoryId,
      brandId,
      isActive,
      stockStatus,
      limit = 20,
      offset = 0,
      onlyWithStock = false,
      restrictToBranchAssigned = false,
    } = params;
    const conditions: string[] = ["company_id = $1"];
    const values: unknown[] = [companyId];
    let i = 2;
    if (branchId) {
      conditions.push(`branch_id = $${i++}`);
      values.push(branchId);
    }
    if (search) {
      conditions.push(
        `(product_name ILIKE $${i} OR product_code ILIKE $${i} OR barcode ILIKE $${i})`,
      );
      values.push(`%${search}%`);
      i++;
    }
    if (categoryId) {
      conditions.push(`category_id = $${i++}`);
      values.push(categoryId);
    }
    if (brandId) {
      conditions.push(`brand_id = $${i++}`);
      values.push(brandId);
    }
    if (isActive !== undefined) {
      conditions.push(`is_active = $${i++}`);
      values.push(isActive);
    }
    if (stockStatus === "out") conditions.push("stock = 0");
    else if (stockStatus === "low")
      conditions.push("stock > 0 AND stock <= 10");
    else if (stockStatus === "available") conditions.push("stock > 0");
    if (onlyWithStock) conditions.push("has_branch_stock = true");
    if (restrictToBranchAssigned && branchId) {
      conditions.push("(has_branch_stock = true OR has_branch_price = true)");
    }

    const whereClause = conditions.join(" AND ");
    const countQuery = `SELECT COUNT(DISTINCT product_id)::int AS total FROM vw_product_branch WHERE ${whereClause}`;
    const dataQuery = branchId
      ? `SELECT * FROM vw_product_branch WHERE ${whereClause} ORDER BY product_name ASC LIMIT $${i} OFFSET $${i + 1}`
      : `SELECT product_id, product_code, product_name, category_id, category_name,
                brand_id, company_id, base_unit, is_active, image_url, barcode, description,
                MIN(branch_id) AS branch_id, '' AS branch_name, '' AS branch_code,
                (SELECT p."sellingPrice" FROM products p WHERE p.id = product_id)::float8 AS selling_price,
                (SELECT p."purchasePrice" FROM products p WHERE p.id = product_id)::float8 AS purchase_price,
                (SELECT p.stock FROM products p WHERE p.id = product_id)::int4 AS stock,
                (SELECT p."minStock" FROM products p WHERE p.id = product_id)::int4 AS min_stock,
                bool_or(has_branch_stock) AS has_branch_stock,
                bool_or(has_branch_price) AS has_branch_price,
                MIN(created_at) AS created_at, MAX(updated_at) AS updated_at
           FROM vw_product_branch
           WHERE ${whereClause}
           GROUP BY product_id, product_code, product_name, category_id, category_name,
                    brand_id, company_id, base_unit, is_active, image_url, barcode, description
           ORDER BY product_name ASC
           LIMIT $${i} OFFSET $${i + 1}`;
    const [countRes, rows] = await Promise.all([
      this.prisma.$queryRawUnsafe<[{ total: number | bigint }]>(
        countQuery,
        ...values,
      ),
      this.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        dataQuery,
        ...values,
        limit,
        offset,
      ),
    ]);
    return { rows, total: Number(countRes[0]?.total ?? 0) };
  }

  async importTemplateData(companyId: string): Promise<{
    categories: { id: string; name: string }[];
    brands: { id: string; name: string }[];
    existingCodes: string[];
    branches: { id: string; name: string; code: string | null }[];
    productCount: number;
  }> {
    const [categories, brands, products, branches, productCount] =
      await Promise.all([
        this.prisma.category.findMany({
          where: { companyId },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
        this.prisma.brand.findMany({
          where: { companyId },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
        this.prisma.product.findMany({
          where: { companyId },
          select: { code: true },
        }),
        this.prisma.branch.findMany({
          where: { companyId, isActive: true },
          select: { id: true, name: true, code: true },
          orderBy: { name: "asc" },
        }),
        this.prisma.product.count({ where: { companyId } }),
      ]);
    return {
      categories,
      brands,
      existingCodes: products.map((p) => p.code),
      branches,
      productCount,
    };
  }
}

function toProductResponse(p: RawProduct): ProductResponse {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    categoryId: p.categoryId,
    category: p.category ? { id: p.category.id, name: p.category.name } : null,
    brandId: p.brandId,
    brand: p.brand ? { id: p.brand.id, name: p.brand.name } : null,
    supplierId: p.supplierId,
    supplier: p.supplier ? { id: p.supplier.id, name: p.supplier.name } : null,
    purchasePrice: p.purchasePrice,
    sellingPrice: p.sellingPrice,
    stock: p.stock,
    minStock: p.minStock,
    barcode: p.barcode,
    unit: p.unit,
    isActive: p.isActive,
    description: p.description,
    imageUrl: p.imageUrl,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}
