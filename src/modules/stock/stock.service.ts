import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type StockMovementType } from "@prisma/client";
import type { PaginatedResponse } from "../../common/types/response";
import { paginate } from "../../common/utils/pagination";
import type {
  AdjustStockDto,
  BranchStockListResponse,
  BranchStockResponse,
  ListBranchStockQueryDto,
  ListStockMovementsQueryDto,
  StockCardEntry,
  StockCardQueryDto,
  StockCardResponse,
  StockMovementResponse,
} from "./dto/stock.dto";
import { PrismaService } from "../prisma/prisma.service";
import { RackStockHelperService } from "../racks/rack-stock-helper.service";
import { RealtimeService, EVENTS } from "../realtime/realtime.service";

const TYPE_GROUPS: Record<string, StockMovementType[]> = {
  IN: ["IN", "MANUAL_IN", "PURCHASE_RECEIVE", "RETURN_IN"],
  OUT: ["OUT", "MANUAL_OUT", "SALE", "RETURN_OUT", "WASTE", "RECIPE_DEDUCT", "RTV"],
  ADJUSTMENT: ["ADJUSTMENT", "OPNAME_ADJUSTMENT"],
  TRANSFER: ["TRANSFER", "TRANSFER_IN", "TRANSFER_OUT"],
  OPNAME: ["OPNAME"],
};

const MOVEMENT_SELECT = {
  id: true,
  productId: true,
  product: { select: { id: true, name: true, code: true, unit: true } },
  branchId: true,
  branch: { select: { id: true, name: true } },
  variantId: true,
  variantLabel: true,
  unitId: true,
  unit: { select: { id: true, name: true, conversionQty: true } },
  unitQuantity: true,
  type: true,
  quantity: true,
  note: true,
  reference: true,
  createdBy: true,
  createdAt: true,
} satisfies Prisma.StockMovementSelect;

type RawMovement = Prisma.StockMovementGetPayload<{
  select: typeof MOVEMENT_SELECT;
}>;

const BRANCH_STOCK_SELECT = {
  id: true,
  branchId: true,
  productId: true,
  product: {
    select: { id: true, code: true, name: true, unit: true },
  },
  quantity: true,
  minStock: true,
  updatedAt: true,
} satisfies Prisma.BranchStockSelect;

type RawBranchStock = Prisma.BranchStockGetPayload<{
  select: typeof BRANCH_STOCK_SELECT;
}>;

@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly rackStockHelper: RackStockHelperService,
  ) {}

  async listMovements(
    companyId: string,
    query: ListStockMovementsQueryDto,
  ): Promise<PaginatedResponse<StockMovementResponse>> {
    const { productId, branchId, type, refType, reference, from, to, page, perPage } =
      query;

    const where: Prisma.StockMovementWhereInput = {
      product: { companyId },
    };
    if (productId) where.productId = productId;
    if (branchId) where.branchId = branchId;
    if (type) {
      const group = TYPE_GROUPS[type as string];
      where.type = group ? { in: group } : type;
    }
    if (refType) where.refType = refType;
    if (reference) {
      where.reference = { contains: reference, mode: "insensitive" };
    }
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    const [rows, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        select: MOVEMENT_SELECT,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.stockMovement.count({ where }),
    ]);

    return paginate(rows.map(toMovementResponse), total, page, perPage);
  }

  async movementSummary(
    companyId: string,
    branchId?: string,
  ) {
    const where: Prisma.StockMovementWhereInput = {
      product: { companyId },
      ...(branchId ? { branchId } : {}),
    };

    const [inCount, outCount, adjCount, transferCount, opnameCount, total] =
      await Promise.all([
        this.prisma.stockMovement.count({ where: { ...where, type: { in: TYPE_GROUPS.IN } } }),
        this.prisma.stockMovement.count({ where: { ...where, type: { in: TYPE_GROUPS.OUT } } }),
        this.prisma.stockMovement.count({ where: { ...where, type: { in: TYPE_GROUPS.ADJUSTMENT } } }),
        this.prisma.stockMovement.count({ where: { ...where, type: { in: TYPE_GROUPS.TRANSFER } } }),
        this.prisma.stockMovement.count({ where: { ...where, type: { in: TYPE_GROUPS.OPNAME } } }),
        this.prisma.stockMovement.count({ where }),
      ]);

    return {
      total,
      inCount,
      outCount,
      adjCount,
      transferCount,
      opnameCount,
    };
  }

  async listBranchStock(
    companyId: string,
    query: ListBranchStockQueryDto,
  ): Promise<BranchStockListResponse> {
    const { branchId, search, lowStock, page, perPage } = query;

    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException("Branch not found");

    const where: Prisma.BranchStockWhereInput = {
      branchId,
      product: { companyId, deletedAt: null },
    };
    if (search) {
      where.product = {
        ...(where.product as Prisma.ProductWhereInput),
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { code: { contains: search, mode: "insensitive" } },
          { barcode: { contains: search, mode: "insensitive" } },
        ],
      };
    }
    if (lowStock) {
      where.quantity = { lte: this.prisma.branchStock.fields.minStock };
    }

    const [rows, total] = await Promise.all([
      this.prisma.branchStock.findMany({
        where,
        select: BRANCH_STOCK_SELECT,
        orderBy: { product: { name: "asc" } },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.branchStock.count({ where }),
    ]);

    return {
      stocks: rows.map(toBranchStockResponse),
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async adjust(
    companyId: string,
    userId: string,
    dto: AdjustStockDto,
  ): Promise<StockMovementResponse> {
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, companyId, deletedAt: null },
      select: { id: true, stock: true },
    });
    if (!product) throw new NotFoundException("Product not found");

    const selectedUnit = dto.unitId
      ? await this.prisma.productUnit.findFirst({
          where: { id: dto.unitId, productId: dto.productId },
          select: { id: true, conversionQty: true },
        })
      : null;
    if (dto.unitId && !selectedUnit) {
      throw new NotFoundException("Satuan produk tidak ditemukan");
    }
    const baseQuantity = dto.quantity * (selectedUnit?.conversionQty ?? 1);
    const branchId = dto.branchId ?? null;
    if (branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: branchId, companyId },
        select: { id: true },
      });
      if (!branch) throw new NotFoundException("Branch not found");
    }

    // Resolve variantLabel utk denormalize ke stockMovement (display di UI).
    let variantLabel: string | null = null;
    if (dto.variantId) {
      const variant = await this.prisma.productVariant.findFirst({
        where: { id: dto.variantId, productId: dto.productId },
        include: {
          options: { select: { option: { select: { name: true } } } },
        },
      });
      if (!variant) {
        throw new NotFoundException("Variant tidak ditemukan");
      }
      variantLabel =
        variant.options.map((o) => o.option.name).join(" · ") || null;
    }

    const delta = dto.type === "OUT" ? -baseQuantity : baseQuantity;

    const movement = await this.prisma.$transaction(async (tx) => {
      let balanceAfter: number | null = null;
      if (branchId) {
        const existing = await tx.branchStock.findUnique({
          where: { branchId_productId: { branchId, productId: dto.productId } },
          select: { quantity: true },
        });
        const current = existing?.quantity ?? 0;
        if (dto.type === "OUT" && current < baseQuantity) {
          throw new BadRequestException(
            `Stok cabang tidak mencukupi (sisa: ${current})`,
          );
        }
        const upserted = await tx.branchStock.upsert({
          where: { branchId_productId: { branchId, productId: dto.productId } },
          create: {
            branchId,
            productId: dto.productId,
            quantity: Math.max(current + delta, 0),
          },
          update: { quantity: { increment: delta } },
          select: { quantity: true },
        });
        balanceAfter = upserted.quantity;

        // Phase 2B: sync RackStock saat adjustment.
        //   - IN/ADJUSTMENT positif → tambah ke rak (rackId eksplisit atau default)
        //   - OUT → kurangi dari rak (FIFO dari default kalau rackId tidak diset,
        //     atau spesifik dari rackId kalau diset)
        if (delta > 0) {
          await this.rackStockHelper.addToRack(tx, {
            branchId,
            productId: dto.productId,
            qty: baseQuantity,
            rackId: dto.rackId ?? null,
            refType: "manual_adjustment",
            ...(dto.reference ? { refId: dto.reference } : {}),
            userId,
            ...(dto.note ? { notes: dto.note } : {}),
            movementType: "MANUAL_IN",
          });
        } else if (delta < 0) {
          if (dto.rackId) {
            // Adjust spesifik rak — kurangi qty di rak itu (boleh ≤ stock rak).
            const existing = await tx.rackStock.findUnique({
              where: {
                rackId_productId: {
                  rackId: dto.rackId,
                  productId: dto.productId,
                },
              },
              select: { qty: true },
            });
            const oldQty = existing?.qty ?? 0;
            const newQty = Math.max(oldQty - baseQuantity, 0);
            await this.rackStockHelper.setRackQty(tx, {
              branchId,
              productId: dto.productId,
              rackId: dto.rackId,
              qty: newQty,
              refType: "manual_adjustment",
              ...(dto.reference ? { refId: dto.reference } : {}),
              userId,
              ...(dto.note ? { notes: dto.note } : {}),
              movementType: "MANUAL_OUT",
            });
          } else {
            await this.rackStockHelper.deductFromRacks(tx, {
              branchId,
              productId: dto.productId,
              qty: baseQuantity,
              refType: "manual_adjustment",
              ...(dto.reference ? { refId: dto.reference } : {}),
              userId,
              ...(dto.note ? { notes: dto.note } : {}),
              movementType: "MANUAL_OUT",
            });
          }
        }

        // Sync hanya base SKU row. Stok operasional disimpan dalam satuan
        // dasar; unit lain dihitung dari conversionQty saat ditampilkan.
        const skuVariantId = dto.variantId ?? null;
        const skuRow = await tx.productBranchSku.findFirst({
          where: {
            productId: dto.productId,
            branchId,
            variantId: skuVariantId,
            unitId: null,
          },
          select: { id: true, stock: true },
        });
        if (skuRow) {
          if (dto.type === "OUT" && skuRow.stock < baseQuantity) {
            throw new BadRequestException(
              `Stok SKU tidak mencukupi (sisa: ${skuRow.stock})`,
            );
          }
          await tx.productBranchSku.update({
            where: { id: skuRow.id },
            data: { stock: { increment: delta } },
          });
        } else if (dto.type !== "OUT") {
          // Buat row baru kalau IN/ADJUSTMENT dgn delta positif & belum ada
          // row utk SKU itu — hindari "ghost" stok di branchStock.
          await tx.productBranchSku.create({
            data: {
              productId: dto.productId,
              branchId,
              unitId: null,
              variantId: skuVariantId,
              sellingPrice: 0,
              purchasePrice: 0,
              stock: Math.max(delta, 0),
              minStock: 5,
              isActive: true,
            },
          });
        }
      } else {
        if (dto.type === "OUT" && product.stock < baseQuantity) {
          throw new BadRequestException(
            `Stok tidak mencukupi (sisa: ${product.stock})`,
          );
        }
        const updatedP = await tx.product.update({
          where: { id: dto.productId },
          data: { stock: { increment: delta } },
          select: { stock: true },
        });
        balanceAfter = updatedP.stock;
      }

      // Map legacy IN/OUT/ADJUSTMENT ke granular MANUAL_IN/MANUAL_OUT supaya
      // kartu stok punya direction & balanceAfter yang konsisten.
      const granularType =
        dto.type === "IN"
          ? "MANUAL_IN"
          : dto.type === "OUT"
            ? "MANUAL_OUT"
            : delta >= 0
              ? "MANUAL_IN"
              : "MANUAL_OUT";
      const direction: "IN" | "OUT" = delta >= 0 ? "IN" : "OUT";

      return tx.stockMovement.create({
        data: {
          productId: dto.productId,
          branchId,
          variantId: dto.variantId ?? null,
          variantLabel,
          unitId: dto.unitId ?? null,
          unitQuantity: dto.unitId ? dto.quantity : null,
          companyId,
          type: granularType,
          quantity: baseQuantity,
          direction,
          balanceAfter,
          refType: "manual_adjustment",
          ...(dto.reference ? { refNumber: dto.reference } : {}),
          note: dto.note ?? null,
          reference: dto.reference ?? null,
          createdBy: userId,
        },
        select: MOVEMENT_SELECT,
      });
    });

    this.realtime.emit(
      EVENTS.STOCK_UPDATED,
      { productId: dto.productId },
      branchId ?? undefined,
    );

    return toMovementResponse(movement);
  }

  async byProduct(
    companyId: string,
    productId: string,
  ): Promise<
    Array<{ branchId: string; quantity: number; minStock: number }>
  > {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, companyId },
      select: { id: true },
    });
    if (!product) return [];
    const stocks = await this.prisma.branchStock.findMany({
      where: { productId },
      select: { branchId: true, quantity: true, minStock: true },
    });
    return stocks;
  }

  /**
   * Kartu Stok — ledger lengkap pergerakan stok satu produk pada satu cabang
   * (atau semua cabang) dengan running balance, summary, & paging.
   *
   * Untuk row legacy (balanceAfter NULL & direction NULL), service merekonstruksi
   * direction dari `type` & quantity-positive convention. Running balance untuk
   * row legacy dihitung kasar dari opening balance — bukan tepat per movement
   * karena urutan write-time tidak deterministik tanpa balanceAfter tersimpan.
   */
  async stockCard(
    companyId: string,
    query: StockCardQueryDto,
  ): Promise<StockCardResponse> {
    const {
      productId,
      branchId,
      variantId,
      dateFrom,
      dateTo,
      type,
      page,
      perPage,
    } = query;

    const product = await this.prisma.product.findFirst({
      where: { id: productId, companyId, deletedAt: null },
      select: { id: true, name: true, code: true, unit: true },
    });
    if (!product) throw new NotFoundException("Product not found");

    let branchInfo: { id: string; name: string } | null = null;
    if (branchId) {
      const b = await this.prisma.branch.findFirst({
        where: { id: branchId, companyId },
        select: { id: true, name: true },
      });
      if (!b) throw new NotFoundException("Branch not found");
      branchInfo = b;
    }

    // Daftar varian produk untuk filter dropdown di UI.
    const productVariants = await this.prisma.productVariant.findMany({
      where: { productId },
      select: {
        id: true,
        options: {
          select: { option: { select: { name: true } } },
        },
      },
    });
    const variantOptions = productVariants.map((v) => ({
      id: v.id,
      label: v.options.map((o) => o.option.name).join(" · "),
    }));

    const where: Prisma.StockMovementWhereInput = {
      productId,
      product: { companyId },
    };
    if (branchId) where.branchId = branchId;
    if (variantId) where.variantId = variantId;
    if (type) where.type = type;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    // Opening balance: saldo akhir di branch_stock saat ini DIKURANGI net
    // movement DALAM/SETELAH periode. Lebih akurat dari recompute dari awal.
    // Catatan: branch_stock belum di-track per varian — saat user filter
    // varian, opening hanya akurat kalau periode mencakup semua mutasi.
    const currentStockResult = branchId
      ? await this.prisma.branchStock.findUnique({
          where: { branchId_productId: { branchId, productId } },
          select: { quantity: true },
        })
      : await this.prisma.branchStock.aggregate({
          where: { productId },
          _sum: { quantity: true },
        });
    const currentStock = branchId
      ? (currentStockResult as { quantity: number } | null)?.quantity ?? 0
      : (currentStockResult as { _sum: { quantity: number | null } })._sum
          .quantity ?? 0;

    // Sum net IN/OUT dari awal periode sampai sekarang (untuk hitung opening).
    const sinceWhere: Prisma.StockMovementWhereInput = {
      productId,
      product: { companyId },
    };
    if (branchId) sinceWhere.branchId = branchId;
    if (variantId) sinceWhere.variantId = variantId;
    if (dateFrom) {
      sinceWhere.createdAt = { gte: new Date(dateFrom) };
    }
    const sinceMovements = await this.prisma.stockMovement.findMany({
      where: sinceWhere,
      select: {
        type: true,
        quantity: true,
        direction: true,
        createdAt: true,
      },
    });
    let netSinceFrom = 0;
    for (const m of sinceMovements) {
      const dir = resolveDirection(m.type, m.direction);
      if (dir === "IN") netSinceFrom += m.quantity;
      else if (dir === "OUT") netSinceFrom -= m.quantity;
    }
    const openingBalance = currentStock - netSinceFrom;

    // Page rows + summary periode
    const [rows, total, periodAgg] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        select: {
          id: true,
          type: true,
          direction: true,
          quantity: true,
          balanceAfter: true,
          unitCost: true,
          totalCost: true,
          refType: true,
          refId: true,
          refNumber: true,
          reference: true,
          note: true,
          createdBy: true,
          createdAt: true,
          variantId: true,
          variantLabel: true,
          branch: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "asc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.stockMovement.count({ where }),
      this.prisma.stockMovement.findMany({
        where,
        select: { type: true, quantity: true, direction: true },
      }),
    ]);

    let totalIn = 0;
    let totalOut = 0;
    for (const m of periodAgg) {
      const dir = resolveDirection(m.type, m.direction);
      if (dir === "IN") totalIn += m.quantity;
      else if (dir === "OUT") totalOut += m.quantity;
    }

    const variantLabelMap = new Map(variantOptions.map((v) => [v.id, v.label]));
    const entries: StockCardEntry[] = rows.map((m) => {
      const dir = resolveDirection(m.type, m.direction);
      const label =
        m.variantLabel ??
        (m.variantId ? variantLabelMap.get(m.variantId) ?? null : null);
      return {
        id: m.id,
        date: m.createdAt.toISOString(),
        type: m.type,
        direction: dir,
        qtyIn: dir === "IN" ? m.quantity : 0,
        qtyOut: dir === "OUT" ? m.quantity : 0,
        balanceAfter: m.balanceAfter ?? null,
        unitCost: m.unitCost !== null ? Number(m.unitCost) : null,
        totalCost: m.totalCost !== null ? Number(m.totalCost) : null,
        refType: m.refType,
        refId: m.refId,
        refNumber: m.refNumber ?? m.reference ?? null,
        note: m.note,
        createdBy: m.createdBy,
        branch: m.branch,
        variantId: m.variantId ?? null,
        variantLabel: label,
      };
    });

    return {
      product: {
        id: product.id,
        name: product.name,
        code: product.code,
        unit: product.unit,
      },
      branch: branchInfo,
      variants: variantOptions,
      summary: {
        openingBalance,
        totalIn,
        totalOut,
        endingBalance: openingBalance + totalIn - totalOut,
        movementCount: total,
      },
      entries,
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }
}

/**
 * Resolve direction dari kolom `direction` (kalau ada) ATAU type+quantity-positive
 * convention untuk row legacy. Beberapa type ambigu (TRANSFER, ADJUSTMENT, OPNAME)
 * di-default menggunakan asumsi yang sama dengan migrasi backfill.
 */
function resolveDirection(
  type: string,
  direction: string | null,
): "IN" | "OUT" | null {
  if (direction === "IN" || direction === "OUT") return direction;
  switch (type) {
    case "IN":
    case "PURCHASE_RECEIVE":
    case "RETURN_IN":
    case "TRANSFER_IN":
    case "MANUAL_IN":
      return "IN";
    case "OUT":
    case "SALE":
    case "RETURN_OUT":
    case "TRANSFER_OUT":
    case "MANUAL_OUT":
    case "WASTE":
    case "RECIPE_DEDUCT":
    case "RTV":
      return "OUT";
    case "ADJUSTMENT":
    case "OPNAME":
    case "OPNAME_ADJUSTMENT":
    case "TRANSFER":
      return null; // ambigu — UI bisa render sebagai netral
    default:
      return null;
  }
}

function toMovementResponse(m: RawMovement): StockMovementResponse {
  return {
    id: m.id,
    productId: m.productId,
    product: m.product
      ? {
          id: m.product.id,
          name: m.product.name,
          code: m.product.code,
          unit: m.product.unit,
        }
      : null,
    branchId: m.branchId,
    branch: m.branch ? { id: m.branch.id, name: m.branch.name } : null,
    variantId: m.variantId ?? null,
    variantLabel: m.variantLabel ?? null,
    unitId: m.unitId ?? null,
    unitName: m.unit?.name ?? null,
    unitQuantity: m.unitQuantity ?? null,
    type: m.type,
    quantity: m.quantity,
    note: m.note,
    reference: m.reference,
    createdBy: m.createdBy,
    createdAt: m.createdAt.toISOString(),
  };
}

function toBranchStockResponse(s: RawBranchStock): BranchStockResponse {
  return {
    id: s.id,
    branchId: s.branchId,
    productId: s.productId,
    product: s.product
      ? {
          id: s.product.id,
          code: s.product.code,
          name: s.product.name,
          unit: s.product.unit,
        }
      : null,
    quantity: s.quantity,
    minStock: s.minStock,
    updatedAt: s.updatedAt.toISOString(),
  };
}
