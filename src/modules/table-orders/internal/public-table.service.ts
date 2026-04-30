import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  PublicCatalogResponse,
  PublicProductDetailResponse,
  PublicProductsPageResponse,
  PublicProductsQueryDto,
  PublicTableInfoResponseDto,
  TableSessionResponse,
} from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";
import { findTableByToken } from "./table-orders.helpers";
import { toSessionResponse } from "./table-orders.mapper";
import { SESSION_SELECT } from "./table-orders.select";

@Injectable()
export class PublicTableService {
  constructor(private readonly prisma: PrismaService) {}

  async getPublicTableInfo(qrToken: string): Promise<PublicTableInfoResponseDto> {
    const table = await findTableByToken(this.prisma, qrToken);
    if (!table.branch) {
      throw new BadRequestException("Meja belum di-assign ke cabang");
    }
    return {
      table: {
        id: table.id,
        number: table.number,
        name: table.name,
        section: table.section,
      },
      branch: { id: table.branch.id, name: table.branch.name },
      companyId: table.branch.companyId,
    };
  }

  async getPublicCatalog(qrToken: string): Promise<PublicCatalogResponse> {
    const table = await findTableByToken(this.prisma, qrToken);
    if (!table.branch) {
      throw new BadRequestException("Meja belum di-assign ke cabang");
    }
    const categories = await this.prisma.category.findMany({
      where: { companyId: table.branch.companyId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return { categories, products: [] };
  }

  async getPublicProducts(
    qrToken: string,
    query: PublicProductsQueryDto,
  ): Promise<PublicProductsPageResponse> {
    const table = await findTableByToken(this.prisma, qrToken);
    if (!table.branch) {
      throw new BadRequestException("Meja belum di-assign ke cabang");
    }
    const companyId = table.branch.companyId;
    const limit = query.limit;

    const where: Prisma.ProductWhereInput = {
      companyId,
      isActive: true,
      deletedAt: null,
    };
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.search && query.search.trim()) {
      const q = query.search.trim();
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { code: { contains: q, mode: "insensitive" } },
        { barcode: { contains: q, mode: "insensitive" } },
      ];
    }

    const rows = await this.prisma.product.findMany({
      where,
      select: {
        id: true,
        name: true,
        code: true,
        categoryId: true,
        category: { select: { name: true } },
        sellingPrice: true,
        imageUrl: true,
        description: true,
        unit: true,
        _count: { select: { units: true, modifierGroups: true } },
      },
      orderBy: { id: "asc" },
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? slice[slice.length - 1]!.id : null;

    return {
      products: slice.map((p) => ({
        id: p.id,
        name: p.name,
        code: p.code,
        categoryId: p.categoryId,
        categoryName: p.category.name,
        sellingPrice: p.sellingPrice,
        imageUrl: p.imageUrl,
        description: p.description,
        unit: p.unit,
        hasUnits: p._count.units > 0,
        hasModifiers: p._count.modifierGroups > 0,
      })),
      nextCursor,
    };
  }

  async getPublicProductDetail(
    qrToken: string,
    productId: string,
  ): Promise<PublicProductDetailResponse> {
    const table = await findTableByToken(this.prisma, qrToken);
    if (!table.branch) {
      throw new BadRequestException("Meja belum di-assign ke cabang");
    }
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        companyId: table.branch.companyId,
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        code: true,
        categoryId: true,
        category: { select: { name: true } },
        sellingPrice: true,
        imageUrl: true,
        description: true,
        unit: true,
        units: {
          select: {
            id: true,
            name: true,
            conversionQty: true,
            sellingPrice: true,
            isDefault: true,
            sortOrder: true,
          },
          orderBy: { sortOrder: "asc" },
        },
        modifierGroups: {
          orderBy: { sortOrder: "asc" },
          include: {
            modifierGroup: {
              include: {
                options: { orderBy: { sortOrder: "asc" } },
              },
            },
          },
        },
      },
    });
    if (!product) throw new NotFoundException("Produk tidak ditemukan");

    return {
      id: product.id,
      name: product.name,
      code: product.code,
      categoryId: product.categoryId,
      categoryName: product.category.name,
      sellingPrice: product.sellingPrice,
      imageUrl: product.imageUrl,
      description: product.description,
      unit: product.unit,
      units: product.units.map((u) => ({
        id: u.id,
        name: u.name,
        conversionQty: u.conversionQty,
        sellingPrice: u.sellingPrice,
        isDefault: u.isDefault,
      })),
      modifierGroups: product.modifierGroups
        .filter((link) => link.modifierGroup.isActive)
        .map((link) => {
          const g = link.modifierGroup;
          return {
            id: g.id,
            name: g.name,
            required: g.required,
            minSelect: g.minSelect,
            maxSelect: g.maxSelect,
            options: g.options
              .filter((o) => o.isActive)
              .map((o) => ({
                id: o.id,
                name: o.name,
                priceAdjustment: o.priceAdjustment,
              })),
          };
        }),
    };
  }

  async getPublicActiveSession(
    qrToken: string,
  ): Promise<TableSessionResponse | null> {
    const table = await findTableByToken(this.prisma, qrToken);
    const session = await this.prisma.tableSession.findFirst({
      where: { tableId: table.id, status: { in: ["OPEN", "AWAITING_PAYMENT"] } },
      select: SESSION_SELECT,
      orderBy: { openedAt: "desc" },
    });
    return session ? toSessionResponse(session) : null;
  }
}
