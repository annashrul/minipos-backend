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
        await tx.branchStock.upsert({
          where: { branchId_productId: { branchId, productId: dto.productId } },
          create: {
            branchId,
            productId: dto.productId,
            quantity: Math.max(current + delta, 0),
          },
          update: { quantity: { increment: delta } },
        });
      } else {
        if (dto.type === "OUT" && product.stock < dto.quantity) {
          throw new BadRequestException(
            `Stok tidak mencukupi (sisa: ${product.stock})`,
          );
        }
        await tx.product.update({
          where: { id: dto.productId },
          data: { stock: { increment: delta } },
        });
      }

      return tx.stockMovement.create({
        data: {
          productId: dto.productId,
          branchId,
          companyId,
          type: dto.type,
          quantity: dto.quantity,
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
