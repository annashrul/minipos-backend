import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  AdjustStockDto,
  BranchStockListResponse,
  BranchStockResponse,
  ListBranchStockQueryDto,
  ListStockMovementsQueryDto,
  StockCardEntry,
  StockCardQueryDto,
  StockCardResponse,
  StockMovementListResponse,
  StockMovementResponse,
} from "@/contracts";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeService, EVENTS } from "../realtime/realtime.service";

const MOVEMENT_SELECT = {
  id: true,
  productId: true,
  product: { select: { id: true, name: true, code: true } },
  branchId: true,
  branch: { select: { id: true, name: true } },
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
  ) {}

  async listMovements(
    companyId: string,
    query: ListStockMovementsQueryDto,
  ): Promise<StockMovementListResponse> {
    const { productId, branchId, type, reference, from, to, page, perPage } =
      query;

    const where: Prisma.StockMovementWhereInput = {
      product: { companyId },
    };
    if (productId) where.productId = productId;
    if (branchId) where.branchId = branchId;
    if (type) where.type = type;
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

    return {
      movements: rows.map(toMovementResponse),
      total,
      totalPages: Math.ceil(total / perPage),
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

    const branchId = dto.branchId ?? null;
    if (branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: branchId, companyId },
        select: { id: true },
      });
      if (!branch) throw new NotFoundException("Branch not found");
    }

    const delta = dto.type === "OUT" ? -dto.quantity : dto.quantity;

    const movement = await this.prisma.$transaction(async (tx) => {
      let balanceAfter: number | null = null;
      if (branchId) {
        const existing = await tx.branchStock.findUnique({
          where: { branchId_productId: { branchId, productId: dto.productId } },
          select: { quantity: true },
        });
        const current = existing?.quantity ?? 0;
        if (dto.type === "OUT" && current < dto.quantity) {
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
      } else {
        if (dto.type === "OUT" && product.stock < dto.quantity) {
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
          companyId,
          type: granularType,
          quantity: dto.quantity,
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
    const { productId, branchId, dateFrom, dateTo, type, page, perPage } = query;

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

    const where: Prisma.StockMovementWhereInput = {
      productId,
      product: { companyId },
    };
    if (branchId) where.branchId = branchId;
    if (type) where.type = type;
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo);
    }

    // Opening balance: saldo akhir di branch_stock saat ini DIKURANGI net
    // movement DALAM/SETELAH periode. Lebih akurat dari recompute dari awal.
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
    // Pakai SQL aggregation supaya cepat di dataset besar.
    const sinceWhere: Prisma.StockMovementWhereInput = {
      productId,
      product: { companyId },
    };
    if (branchId) sinceWhere.branchId = branchId;
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

    const entries: StockCardEntry[] = rows.map((m) => {
      const dir = resolveDirection(m.type, m.direction);
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
      ? { id: m.product.id, name: m.product.name, code: m.product.code }
      : null,
    branchId: m.branchId,
    branch: m.branch ? { id: m.branch.id, name: m.branch.name } : null,
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
