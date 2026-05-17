import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateRackDto,
  ListRacksQueryDto,
  ProductRackLookupResponse,
  RackDetailResponse,
  RackListResponse,
  RackResponse,
  SetRackStockDto,
  TransferRackStockDto,
  UpdateRackDto,
} from "@/contracts";
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

  async list(
    companyId: string,
    query: ListRacksQueryDto,
  ): Promise<RackListResponse> {
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

    return {
      racks: rows.map((r) => toRackResponse(r, stockMap.get(r.id))),
      total,
      totalPages: Math.ceil(total / perPage),
    };
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
