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
} from "./dto/table-orders.dto";
import { TableOrdersRepository } from "./table-orders.repository";
import {
  findTableByToken,
  cleanupStaleSessions,
  toSessionResponse,
} from "./table-orders.helpers";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { RealtimeService } from "@/modules/realtime/realtime.service";

@Injectable()
export class TablePublicService {
  constructor(
    private readonly repo: TableOrdersRepository,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async getPublicTableInfo(
    qrToken: string,
  ): Promise<PublicTableInfoResponseDto> {
    const table = await findTableByToken(this.repo, qrToken);
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
      branch: {
        id: table.branch.id,
        name: table.branch.name,
      },
      companyId: table.branch.companyId,
    };
  }

  /**
   * Lightweight catalog header -- categories only.
   * Products are fetched separately via `getPublicProducts` (paginated).
   */
  async getPublicCatalog(qrToken: string): Promise<PublicCatalogResponse> {
    const table = await findTableByToken(this.repo, qrToken);
    if (!table.branch) {
      throw new BadRequestException("Meja belum di-assign ke cabang");
    }
    const categories = await this.repo.findCatalogCategories(table.branch.companyId);
    return { categories, products: [] };
  }

  /**
   * Cursor-based pagination for tablet menu.
   * Cursor = last product `id` in previous page (orderBy id asc -- stable + indexed).
   */
  async getPublicProducts(
    qrToken: string,
    query: PublicProductsQueryDto,
  ): Promise<PublicProductsPageResponse> {
    const table = await findTableByToken(this.repo, qrToken);
    if (!table.branch) {
      throw new BadRequestException("Meja belum di-assign ke cabang");
    }
    const companyId = table.branch.companyId;
    const limit = query.limit;

    const where: Prisma.ProductWhereInput = {
      companyId,
      isActive: true,
      itemType: { not: "INGREDIENT" },
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

    const rows = await this.repo.findPublicProducts(where, limit, query.cursor);

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
    const table = await findTableByToken(this.repo, qrToken);
    if (!table.branch) {
      throw new BadRequestException("Meja belum di-assign ke cabang");
    }
    const product = await this.repo.findPublicProductDetail(
      table.branch.companyId,
      productId,
    );
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

  /** Get the active session for a table (or null if none). */
  async getPublicActiveSession(
    qrToken: string,
  ): Promise<TableSessionResponse | null> {
    const table = await findTableByToken(this.repo, qrToken);
    if (table.branch) {
      await cleanupStaleSessions(
        this.repo,
        this.prisma,
        this.realtime,
        table.branch.companyId,
        table.branch.id,
      );
    }
    const session = await this.repo.findActiveSession(table.id);
    return session ? toSessionResponse(session) : null;
  }
}
