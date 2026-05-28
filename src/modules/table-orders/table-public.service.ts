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
  PublicSessionQueryDto,
  PublicSessionResponse,
  PublicTableInfoResponseDto,
} from "./dto/table-orders.dto";
import { ORDER_SELECT, TableOrdersRepository } from "./table-orders.repository";
import {
  findTableByToken,
  cleanupStaleSessions,
  toOrderResponse,
  toSessionResponse,
} from "./table-orders.helpers";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { ProductSearchService } from "@/modules/products/product-search.service";
import { RealtimeService } from "@/modules/realtime/realtime.service";

@Injectable()
export class TablePublicService {
  constructor(
    private readonly repo: TableOrdersRepository,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    // Dipakai untuk hitung recipe stock (BOM) supaya item dengan bahan
    // baku habis otomatis tampil "Stok habis" di menu tablet — pola sama
    // dengan POS productSearch.
    private readonly productSearch: ProductSearchService,
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

    // Hitung recipe stock untuk produk yang punya BOM. Untuk produk non-recipe
    // fallback ke product.stock (raw stock). Branch dilewatin supaya bahan
    // baku yang diambil = branch stock kalau ada, fallback global.
    const recipeStockByProduct = await this.productSearch.computeRecipeStockByProduct(
      companyId,
      slice.map((p) => p.id),
      table.branch.id,
    );

    return {
      products: slice.map((p) => {
        const recipeStock = recipeStockByProduct.get(p.id);
        const effectiveStock = recipeStock ?? p.stock ?? 0;
        return {
          id: p.id,
          name: p.name,
          code: p.code,
          categoryId: p.categoryId,
          categoryName: p.category.name,
          sellingPrice: p.sellingPrice,
          imageUrl: p.imageUrl,
          description: p.description,
          unit: p.unit,
          stock: effectiveStock,
          hasUnits: p._count.units > 0,
          hasModifiers: p._count.modifierGroups > 0,
        };
      }),
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

    // Compute recipe stock untuk detail juga (consistent dengan getPublicProducts).
    const recipeStockMap = await this.productSearch.computeRecipeStockByProduct(
      table.branch.companyId,
      [product.id],
      table.branch.id,
    );
    const effectiveStock = recipeStockMap.get(product.id) ?? product.stock ?? 0;

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
      stock: effectiveStock,
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

  /** Get the active session for a table + device's cross-table history.
   *
   * Response:
   * - `session`: session aktif di meja saat ini, orders sudah di-filter
   *   by device/phone. Bisa null kalau meja kosong.
   * - `deviceHistory`: orders dari MEJA LAIN (session lain) di branch
   *   yang sama, dalam 7 hari terakhir, dibuat oleh device/phone yang
   *   sama. Customer yang pindah meja tetap bisa lihat riwayat order
   *   sebelumnya.
   */
  async getPublicActiveSession(
    qrToken: string,
    query: PublicSessionQueryDto = {},
  ): Promise<PublicSessionResponse> {
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
    const deviceId = query.deviceId?.trim();
    const phone = query.phone?.trim();

    let sessionResp = session ? toSessionResponse(session) : null;
    if (sessionResp && (deviceId || phone)) {
      sessionResp.orders = (sessionResp.orders ?? []).filter((o) => {
        const matchDevice = !!deviceId && o.deviceId === deviceId;
        const matchPhone = !!phone && o.customerPhone === phone;
        return matchDevice || matchPhone;
      });
    }

    // Device history — orders dari session lain (meja lain) di branch sama,
    // last 7 days. Hanya kalau query bawa deviceId/phone.
    let deviceHistory: PublicSessionResponse["deviceHistory"] = [];
    if ((deviceId || phone) && table.branch) {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const orConditions: Array<Record<string, unknown>> = [];
      if (deviceId) orConditions.push({ deviceId });
      if (phone) orConditions.push({ customerPhone: phone });
      const otherOrders = await this.prisma.tableOrder.findMany({
        where: {
          branchId: table.branch.id,
          // Exclude orders dari session aktif saat ini (sudah di session.orders)
          ...(session ? { sessionId: { not: session.id } } : {}),
          status: { notIn: ["CANCELLED", "REJECTED"] },
          createdAt: { gte: sevenDaysAgo },
          OR: orConditions,
        },
        select: ORDER_SELECT,
        orderBy: { createdAt: "desc" },
        take: 30,
      });
      deviceHistory = otherOrders.map(toOrderResponse);
    }

    return { session: sessionResp, deviceHistory };
  }
}
