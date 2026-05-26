import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  AssignProductsToRackDto,
  CreateRackDto,
  DiscrepancyReportResponse,
  ListRackMovementsQueryDto,
  ListRacksQueryDto,
  ProductRackLookupResponse,
  RackDetailResponse,
  RackMovementListResponse,
  RackResponse,
  ReportDiscrepancyDto,
  SetRackStockDto,
  TransferRackStockDto,
  UpdateRackDto,
} from "./dto/racks.dto";
import type { PaginatedResponse } from "../../common/types/response";
import { paginate } from "../../common/utils/pagination";
import { PrismaService } from "../prisma/prisma.service";

const RACK_SELECT = {
  id: true,
  code: true,
  name: true,
  location: true,
  notes: true,
  isActive: true,
  branchId: true,
  branch: { select: { id: true, name: true } },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.RackSelect;

type RawRack = Prisma.RackGetPayload<{ select: typeof RACK_SELECT }>;

@Injectable()
export class RacksService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(companyId: string, branchId?: string) {
    const where: Prisma.RackWhereInput = { companyId };
    if (branchId) where.branchId = branchId;
    const [total, active, inactive] = await Promise.all([
      this.prisma.rack.count({ where }),
      this.prisma.rack.count({ where: { ...where, isActive: true } }),
      this.prisma.rack.count({ where: { ...where, isActive: false } }),
    ]);
    return { total, active, inactive };
  }

  async list(
    companyId: string,
    query: ListRacksQueryDto,
  ): Promise<PaginatedResponse<RackResponse>> {
    const { search, branchId, isActive, page, perPage } = query;
    const where: Prisma.RackWhereInput = { companyId };
    if (branchId) where.branchId = branchId;
    if (search) {
      where.OR = [
        { code: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
        { location: { contains: search, mode: "insensitive" } },
      ];
    }
    if (isActive !== undefined) where.isActive = isActive;

    const [rows, total] = await Promise.all([
      this.prisma.rack.findMany({
        where,
        select: RACK_SELECT,
        orderBy: [{ branchId: "asc" }, { code: "asc" }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.rack.count({ where }),
    ]);

    const rackIds = rows.map((r) => r.id);
    // Phase 2A: RackStock = source of truth untuk count + total qty.
    // Plus tampilkan produk yang punya defaultRackId tapi belum di
    // RackStock (qty=0 placeholder) untuk visibility.
    const [rackStocks, defaultRackProducts] = await Promise.all([
      rackIds.length > 0
        ? this.prisma.rackStock.groupBy({
            by: ["rackId"],
            where: { rackId: { in: rackIds }, qty: { gt: 0 } },
            _count: { productId: true },
            _sum: { qty: true },
          })
        : Promise.resolve([]),
      rackIds.length > 0
        ? this.prisma.product.groupBy({
            by: ["defaultRackId"],
            where: { defaultRackId: { in: rackIds }, companyId },
            _count: { id: true },
          })
        : Promise.resolve([]),
    ]);

    const stockByRack = new Map(
      rackStocks.map((s) => [
        s.rackId,
        {
          productCount: s._count.productId,
          totalQty: s._sum.qty ?? 0,
        },
      ]),
    );
    const defaultCountByRack = new Map(
      defaultRackProducts
        .filter((p) => p.defaultRackId)
        .map((p) => [p.defaultRackId as string, p._count.id]),
    );
    const stockMap = new Map(
      rackIds.map((id) => {
        const rs = stockByRack.get(id);
        const defaultCount = defaultCountByRack.get(id) ?? 0;
        return [
          id,
          {
            // Take max: produk dengan qty > 0 + produk yang assigned default
            // tapi belum punya RackStock entry.
            productCount: Math.max(rs?.productCount ?? 0, defaultCount),
            totalQty: rs?.totalQty ?? 0,
          },
        ];
      }),
    );

    return paginate(rows.map((r) => toRackResponse(r, stockMap.get(r.id))), total, page, perPage);
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<RackDetailResponse> {
    const rack = await this.prisma.rack.findFirst({
      where: { id, companyId },
      select: RACK_SELECT,
    });
    if (!rack) throw new NotFoundException("Rack not found");

    // Phase 2A: union dari RackStock (qty actual di rak ini) DAN produk
    // dengan defaultRackId=id (placeholder qty=0 untuk visibility kalau
    // admin belum input stok manual ke rak ini).
    const [rackStocks, defaultProducts] = await Promise.all([
      this.prisma.rackStock.findMany({
        where: { rackId: id },
        select: {
          qty: true,
          product: {
            select: {
              id: true,
              code: true,
              name: true,
              unit: true,
              imageUrl: true,
              defaultRackId: true,
            },
          },
        },
        orderBy: { qty: "desc" },
      }),
      this.prisma.product.findMany({
        where: { defaultRackId: id, companyId },
        select: {
          id: true,
          code: true,
          name: true,
          unit: true,
          imageUrl: true,
        },
      }),
    ]);

    const stockProductIds = new Set(rackStocks.map((s) => s.product.id));
    const items = [
      ...rackStocks.map((s) => ({
        productId: s.product.id,
        productCode: s.product.code,
        productName: s.product.name,
        unit: s.product.unit,
        qty: s.qty,
        imageUrl: s.product.imageUrl,
        isDefaultRack: s.product.defaultRackId === id,
      })),
      ...defaultProducts
        .filter((p) => !stockProductIds.has(p.id))
        .map((p) => ({
          productId: p.id,
          productCode: p.code,
          productName: p.name,
          unit: p.unit,
          qty: 0,
          imageUrl: p.imageUrl,
          isDefaultRack: true,
        })),
    ];

    const stockSummary = {
      productCount: items.length,
      totalQty: items.reduce((sum, i) => sum + i.qty, 0),
    };

    return {
      ...toRackResponse(rack, stockSummary),
      items,
    };
  }

  async create(
    companyId: string,
    dto: CreateRackDto,
  ): Promise<RackResponse> {
    // Verify branch belongs to company
    const branch = await this.prisma.branch.findFirst({
      where: { id: dto.branchId, companyId },
      select: { id: true },
    });
    if (!branch) {
      throw new BadRequestException("Branch tidak ditemukan");
    }
    try {
      const created = await this.prisma.rack.create({
        data: {
          branchId: dto.branchId,
          companyId,
          code: dto.code,
          name: dto.name,
          location: dto.location ?? null,
          notes: dto.notes ?? null,
          isActive: dto.isActive ?? true,
        },
        select: RACK_SELECT,
      });
      return toRackResponse(created);
    } catch (err) {
      throwOnDupRack(err);
      throw err;
    }
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateRackDto,
  ): Promise<RackResponse> {
    const existing = await this.prisma.rack.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Rack not found");

    const data: Prisma.RackUpdateInput = {};
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.location !== undefined) data.location = dto.location;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    try {
      const updated = await this.prisma.rack.update({
        where: { id },
        data,
        select: RACK_SELECT,
      });
      return toRackResponse(updated);
    } catch (err) {
      throwOnDupRack(err);
      throw err;
    }
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const existing = await this.prisma.rack.findFirst({
      where: { id, companyId },
      select: {
        id: true,
        _count: { select: { rackStocks: true } },
      },
    });
    if (!existing) throw new NotFoundException("Rack not found");
    if (existing._count.rackStocks > 0) {
      throw new BadRequestException(
        `Rak masih punya ${existing._count.rackStocks} produk dengan stok. Pindahkan stok dulu sebelum hapus.`,
      );
    }
    // Clear defaultRackId on any product still pointing here
    await this.prisma.product.updateMany({
      where: { defaultRackId: id, companyId },
      data: { defaultRackId: null },
    });
    await this.prisma.rack.delete({ where: { id } });
    return { success: true };
  }

  async bulkDelete(
    companyId: string,
    ids: string[],
  ): Promise<{ count: number; skipped: string[] }> {
    const [skippedRows, deletableRows] = await Promise.all([
      this.prisma.rack.findMany({
        where: { id: { in: ids }, companyId, rackStocks: { some: {} } },
        select: { name: true },
      }),
      this.prisma.rack.findMany({
        where: { id: { in: ids }, companyId, rackStocks: { none: {} } },
        select: { id: true },
      }),
    ]);
    const deletableIds = deletableRows.map((r) => r.id);
    let count = 0;
    if (deletableIds.length > 0) {
      await this.prisma.product.updateMany({
        where: { defaultRackId: { in: deletableIds }, companyId },
        data: { defaultRackId: null },
      });
      const result = await this.prisma.rack.deleteMany({ where: { id: { in: deletableIds } } });
      count = result.count;
    }
    return { count, skipped: skippedRows.map((r) => r.name) };
  }

  async productLookup(
    companyId: string,
    productId: string,
    branchId?: string,
  ): Promise<ProductRackLookupResponse> {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, companyId },
      select: {
        id: true,
        code: true,
        name: true,
        unit: true,
        defaultRackId: true,
      },
    });
    if (!product) throw new NotFoundException("Product not found");

    const where: Prisma.RackStockWhereInput = {
      productId,
      rack: { companyId },
    };
    if (branchId) where.branchId = branchId;

    const stocks = await this.prisma.rackStock.findMany({
      where,
      select: {
        qty: true,
        rack: {
          select: {
            id: true,
            code: true,
            name: true,
            branch: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { qty: "desc" },
    });

    const totalQty = stocks.reduce((sum, s) => sum + s.qty, 0);
    return {
      productId: product.id,
      productCode: product.code,
      productName: product.name,
      unit: product.unit,
      totalQty,
      locations: stocks.map((s) => ({
        rackId: s.rack.id,
        rackCode: s.rack.code,
        rackName: s.rack.name,
        branchId: s.rack.branch.id,
        branchName: s.rack.branch.name,
        qty: s.qty,
        isDefault: product.defaultRackId === s.rack.id,
      })),
    };
  }

  /**
   * Phase 2A: upsert qty produk ke rak (manual entry). Setiap perubahan
   * dicatat di RackStockMovement sebagai ADJUST. Qty 0 → row dihapus.
   */
  async setStock(
    companyId: string,
    rackId: string,
    dto: SetRackStockDto,
    userId?: string,
  ): Promise<{ success: true; updated: number }> {
    const rack = await this.prisma.rack.findFirst({
      where: { id: rackId, companyId },
      select: { id: true, branchId: true },
    });
    if (!rack) throw new NotFoundException("Rack not found");

    const productIds = dto.items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, companyId },
      select: { id: true },
    });
    const validProductIds = new Set(products.map((p) => p.id));
    const invalid = productIds.filter((id) => !validProductIds.has(id));
    if (invalid.length > 0) {
      throw new BadRequestException(
        `Produk tidak ditemukan: ${invalid.join(", ")}`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      for (const item of dto.items) {
        const existing = await tx.rackStock.findUnique({
          where: {
            rackId_productId: { rackId, productId: item.productId },
          },
          select: { qty: true },
        });
        const oldQty = existing?.qty ?? 0;
        const delta = item.qty - oldQty;

        if (item.qty === 0) {
          if (existing) {
            await tx.rackStock.delete({
              where: {
                rackId_productId: { rackId, productId: item.productId },
              },
            });
          }
        } else {
          await tx.rackStock.upsert({
            where: {
              rackId_productId: { rackId, productId: item.productId },
            },
            update: { qty: item.qty },
            create: {
              rackId,
              productId: item.productId,
              branchId: rack.branchId,
              qty: item.qty,
            },
          });
        }

        if (delta !== 0) {
          await tx.rackStockMovement.create({
            data: {
              productId: item.productId,
              branchId: rack.branchId,
              toRackId: delta > 0 ? rackId : null,
              fromRackId: delta < 0 ? rackId : null,
              qty: Math.abs(delta),
              type: "ADJUST",
              ...(userId ? { byUserId: userId } : {}),
              ...(dto.notes ? { notes: dto.notes } : {}),
            },
          });
        }
      }
    });

    return { success: true, updated: dto.items.length };
  }

  /**
   * Bulk replace produk yang punya defaultRackId = rackId. Produk lama yang
   * tidak ada di payload akan di-unset (defaultRackId = null). Tidak menyentuh
   * RackStock — itu di-handle lewat setStock/transfer.
   */
  async assignProducts(
    companyId: string,
    rackId: string,
    dto: AssignProductsToRackDto,
  ): Promise<{ success: true; assigned: number; unassigned: number }> {
    const rack = await this.prisma.rack.findFirst({
      where: { id: rackId, companyId },
      select: { id: true },
    });
    if (!rack) throw new NotFoundException("Rack not found");

    if (dto.productIds.length > 0) {
      const products = await this.prisma.product.findMany({
        where: { id: { in: dto.productIds }, companyId },
        select: { id: true },
      });
      if (products.length !== dto.productIds.length) {
        throw new BadRequestException("Beberapa produk tidak ditemukan");
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Unset produk lama yang masih point ke rak ini tapi tidak ada di payload.
      const unset = await tx.product.updateMany({
        where: {
          defaultRackId: rackId,
          companyId,
          ...(dto.productIds.length > 0
            ? { id: { notIn: dto.productIds } }
            : {}),
        },
        data: { defaultRackId: null },
      });

      // Set defaultRackId untuk produk yang dipilih.
      let assigned = 0;
      if (dto.productIds.length > 0) {
        const set = await tx.product.updateMany({
          where: { id: { in: dto.productIds }, companyId },
          data: { defaultRackId: rackId },
        });
        assigned = set.count;
      }
      return { assigned, unassigned: unset.count };
    });

    return { success: true, ...result };
  }

  /**
   * Phase 2A: pindah qty antar rak. Validasi:
   * - Kedua rak harus exist & sama company
   * - Kedua rak harus di cabang yang sama (transfer antar cabang dilakukan
   *   lewat StockTransfer yang sudah ada)
   * - Qty di rak asal harus cukup
   * Mutasi atomic, log 1 RackStockMovement per item.
   */
  async transfer(
    companyId: string,
    dto: TransferRackStockDto,
    userId?: string,
  ): Promise<{ success: true; transferred: number }> {
    if (dto.fromRackId === dto.toRackId) {
      throw new BadRequestException("Rak asal dan tujuan tidak boleh sama");
    }
    const [fromRack, toRack] = await Promise.all([
      this.prisma.rack.findFirst({
        where: { id: dto.fromRackId, companyId },
        select: { id: true, branchId: true, code: true },
      }),
      this.prisma.rack.findFirst({
        where: { id: dto.toRackId, companyId },
        select: { id: true, branchId: true, code: true },
      }),
    ]);
    if (!fromRack || !toRack) {
      throw new NotFoundException("Rak asal atau tujuan tidak ditemukan");
    }
    if (fromRack.branchId !== toRack.branchId) {
      throw new BadRequestException(
        "Transfer antar cabang dilakukan via menu Stock Transfer, bukan rak ke rak.",
      );
    }

    await this.prisma.$transaction(async (tx) => {
      for (const item of dto.items) {
        const fromStock = await tx.rackStock.findUnique({
          where: {
            rackId_productId: {
              rackId: dto.fromRackId,
              productId: item.productId,
            },
          },
          select: { qty: true },
        });
        if (!fromStock || fromStock.qty < item.qty) {
          throw new BadRequestException(
            `Stok di rak asal tidak cukup untuk produk ${item.productId.slice(0, 8)}`,
          );
        }

        // Decrement source
        const remaining = fromStock.qty - item.qty;
        if (remaining === 0) {
          await tx.rackStock.delete({
            where: {
              rackId_productId: {
                rackId: dto.fromRackId,
                productId: item.productId,
              },
            },
          });
        } else {
          await tx.rackStock.update({
            where: {
              rackId_productId: {
                rackId: dto.fromRackId,
                productId: item.productId,
              },
            },
            data: { qty: remaining },
          });
        }

        // Increment destination
        await tx.rackStock.upsert({
          where: {
            rackId_productId: {
              rackId: dto.toRackId,
              productId: item.productId,
            },
          },
          update: { qty: { increment: item.qty } },
          create: {
            rackId: dto.toRackId,
            productId: item.productId,
            branchId: toRack.branchId,
            qty: item.qty,
          },
        });

        await tx.rackStockMovement.create({
          data: {
            productId: item.productId,
            branchId: fromRack.branchId,
            fromRackId: dto.fromRackId,
            toRackId: dto.toRackId,
            qty: item.qty,
            type: "TRANSFER",
            ...(userId ? { byUserId: userId } : {}),
            ...(dto.notes ? { notes: dto.notes } : {}),
          },
        });
      }
    });

    return { success: true, transferred: dto.items.length };
  }

  /**
   * Phase 3: list RackStockMovement dengan filter & pagination. Dipakai
   * halaman audit log buat trace siapa, kapan, ngapain di rak.
   */
  async listMovements(
    companyId: string,
    query: ListRackMovementsQueryDto,
  ): Promise<RackMovementListResponse> {
    const { rackId, branchId, productId, type, dateFrom, dateTo, page, perPage } =
      query;
    const where: Prisma.RackStockMovementWhereInput = {
      product: { companyId },
    };
    if (branchId) where.branchId = branchId;
    if (productId) where.productId = productId;
    if (type) where.type = type;
    if (rackId) {
      where.OR = [{ fromRackId: rackId }, { toRackId: rackId }];
    }
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    const [rows, total] = await Promise.all([
      this.prisma.rackStockMovement.findMany({
        where,
        select: {
          id: true,
          qty: true,
          type: true,
          refType: true,
          refId: true,
          notes: true,
          createdAt: true,
          byUserId: true,
          byUser: { select: { id: true, name: true } },
          branchId: true,
          branch: { select: { id: true, name: true } },
          productId: true,
          product: {
            select: { id: true, code: true, name: true, unit: true },
          },
          fromRackId: true,
          fromRack: { select: { id: true, code: true } },
          toRackId: true,
          toRack: { select: { id: true, code: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.rackStockMovement.count({ where }),
    ]);

    return {
      movements: rows.map((r) => ({
        id: r.id,
        productId: r.productId,
        productCode: r.product.code,
        productName: r.product.name,
        unit: r.product.unit,
        branchId: r.branchId,
        branchName: r.branch.name,
        fromRackId: r.fromRackId,
        fromRackCode: r.fromRack?.code ?? null,
        toRackId: r.toRackId,
        toRackCode: r.toRack?.code ?? null,
        qty: r.qty,
        type: r.type,
        refType: r.refType,
        refId: r.refId,
        notes: r.notes,
        byUserId: r.byUserId,
        byUserName: r.byUser?.name ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  /**
   * Phase 3: user lapor selisih stok di rak. Buat record RackDiscrepancy
   * (status OPEN), TIDAK auto-apply adjustment — admin harus investigate &
   * resolve manual via UI.
   */
  async reportDiscrepancy(
    companyId: string,
    userId: string,
    dto: ReportDiscrepancyDto,
  ): Promise<DiscrepancyReportResponse> {
    const rack = await this.prisma.rack.findFirst({
      where: { id: dto.rackId, companyId },
      select: { id: true, code: true, branchId: true },
    });
    if (!rack) throw new NotFoundException("Rack not found");
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, companyId },
      select: { id: true, code: true, name: true },
    });
    if (!product) throw new NotFoundException("Product not found");

    const difference = dto.actualQty - dto.expectedQty;
    const created = await this.prisma.rackDiscrepancy.create({
      data: {
        rackId: rack.id,
        productId: product.id,
        branchId: rack.branchId,
        companyId,
        expectedQty: dto.expectedQty,
        actualQty: dto.actualQty,
        difference,
        status: "OPEN",
        notes: dto.notes ?? null,
        reportedByUserId: userId,
      },
      select: {
        id: true,
        rackId: true,
        productId: true,
        expectedQty: true,
        actualQty: true,
        difference: true,
        status: true,
        notes: true,
        reportedByUserId: true,
        reportedAt: true,
        resolvedAt: true,
        reportedBy: { select: { name: true } },
      },
    });
    return {
      id: created.id,
      rackId: created.rackId,
      rackCode: rack.code,
      productId: created.productId,
      productCode: product.code,
      productName: product.name,
      expectedQty: created.expectedQty,
      actualQty: created.actualQty,
      difference: created.difference,
      status: created.status as "OPEN" | "RESOLVED",
      notes: created.notes,
      reportedByUserId: created.reportedByUserId,
      reportedByName: created.reportedBy.name,
      reportedAt: created.reportedAt.toISOString(),
      resolvedAt: created.resolvedAt?.toISOString() ?? null,
    };
  }

  async listDiscrepancies(
    companyId: string,
    status?: "OPEN" | "RESOLVED",
  ): Promise<DiscrepancyReportResponse[]> {
    const where: Prisma.RackDiscrepancyWhereInput = { companyId };
    if (status) where.status = status;
    const rows = await this.prisma.rackDiscrepancy.findMany({
      where,
      select: {
        id: true,
        rackId: true,
        rack: { select: { code: true } },
        productId: true,
        product: { select: { code: true, name: true } },
        expectedQty: true,
        actualQty: true,
        difference: true,
        status: true,
        notes: true,
        reportedByUserId: true,
        reportedBy: { select: { name: true } },
        reportedAt: true,
        resolvedAt: true,
      },
      orderBy: { reportedAt: "desc" },
    });
    return rows.map((r) => ({
      id: r.id,
      rackId: r.rackId,
      rackCode: r.rack.code,
      productId: r.productId,
      productCode: r.product.code,
      productName: r.product.name,
      expectedQty: r.expectedQty,
      actualQty: r.actualQty,
      difference: r.difference,
      status: r.status as "OPEN" | "RESOLVED",
      notes: r.notes,
      reportedByUserId: r.reportedByUserId,
      reportedByName: r.reportedBy.name,
      reportedAt: r.reportedAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
    }));
  }

  async resolveDiscrepancy(
    companyId: string,
    userId: string,
    id: string,
    applyAdjustment: boolean,
  ): Promise<DiscrepancyReportResponse> {
    const disc = await this.prisma.rackDiscrepancy.findFirst({
      where: { id, companyId, status: "OPEN" },
      select: {
        id: true,
        rackId: true,
        productId: true,
        branchId: true,
        actualQty: true,
        expectedQty: true,
        difference: true,
      },
    });
    if (!disc) throw new NotFoundException("Discrepancy not found or already resolved");

    await this.prisma.$transaction(async (tx) => {
      if (applyAdjustment && disc.difference !== 0) {
        // Set RackStock qty ke actual (final value) + log movement.
        const existing = await tx.rackStock.findUnique({
          where: {
            rackId_productId: {
              rackId: disc.rackId,
              productId: disc.productId,
            },
          },
          select: { qty: true },
        });
        const oldQty = existing?.qty ?? 0;
        const delta = disc.actualQty - oldQty;

        if (disc.actualQty === 0 && existing) {
          await tx.rackStock.delete({
            where: {
              rackId_productId: {
                rackId: disc.rackId,
                productId: disc.productId,
              },
            },
          });
        } else if (disc.actualQty > 0) {
          await tx.rackStock.upsert({
            where: {
              rackId_productId: {
                rackId: disc.rackId,
                productId: disc.productId,
              },
            },
            update: { qty: disc.actualQty },
            create: {
              rackId: disc.rackId,
              productId: disc.productId,
              branchId: disc.branchId,
              qty: disc.actualQty,
            },
          });
        }
        if (delta !== 0) {
          await tx.rackStockMovement.create({
            data: {
              productId: disc.productId,
              branchId: disc.branchId,
              fromRackId: delta < 0 ? disc.rackId : null,
              toRackId: delta > 0 ? disc.rackId : null,
              qty: Math.abs(delta),
              type: "DISCREPANCY_RESOLVE",
              refType: "rack_discrepancy",
              refId: disc.id,
              byUserId: userId,
              notes: `Resolve discrepancy ${disc.id}`,
            },
          });
          // Sinkronkan BranchStock (delta sama).
          await tx.branchStock.upsert({
            where: {
              branchId_productId: {
                branchId: disc.branchId,
                productId: disc.productId,
              },
            },
            update: { quantity: { increment: delta } },
            create: {
              branchId: disc.branchId,
              productId: disc.productId,
              quantity: Math.max(delta, 0),
            },
          });
        }
      }
      await tx.rackDiscrepancy.update({
        where: { id },
        data: {
          status: "RESOLVED",
          resolvedAt: new Date(),
          resolvedByUserId: userId,
        },
      });
    });

    const updated = await this.prisma.rackDiscrepancy.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        rackId: true,
        rack: { select: { code: true } },
        productId: true,
        product: { select: { code: true, name: true } },
        expectedQty: true,
        actualQty: true,
        difference: true,
        status: true,
        notes: true,
        reportedByUserId: true,
        reportedBy: { select: { name: true } },
        reportedAt: true,
        resolvedAt: true,
      },
    });
    return {
      id: updated.id,
      rackId: updated.rackId,
      rackCode: updated.rack.code,
      productId: updated.productId,
      productCode: updated.product.code,
      productName: updated.product.name,
      expectedQty: updated.expectedQty,
      actualQty: updated.actualQty,
      difference: updated.difference,
      status: updated.status as "OPEN" | "RESOLVED",
      notes: updated.notes,
      reportedByUserId: updated.reportedByUserId,
      reportedByName: updated.reportedBy.name,
      reportedAt: updated.reportedAt.toISOString(),
      resolvedAt: updated.resolvedAt?.toISOString() ?? null,
    };
  }
}

function toRackResponse(
  r: RawRack,
  summary?: { productCount: number; totalQty: number },
): RackResponse {
  return {
    id: r.id,
    branchId: r.branchId,
    branchName: r.branch.name,
    code: r.code,
    name: r.name,
    location: r.location,
    notes: r.notes,
    isActive: r.isActive,
    productCount: summary?.productCount ?? 0,
    totalQty: summary?.totalQty ?? 0,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function throwOnDupRack(err: unknown): void {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    throw new ConflictException(
      "Kode rak sudah dipakai di cabang ini. Pilih kode lain.",
    );
  }
}
