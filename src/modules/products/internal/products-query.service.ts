import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { ProductResponse } from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";
import { PRODUCT_SELECT, toProductResponse } from "./products.shared";

@Injectable()
export class ProductsQueryService {
  constructor(private readonly prisma: PrismaService) {}

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
