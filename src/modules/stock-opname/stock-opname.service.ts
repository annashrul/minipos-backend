import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateStockOpnameDto,
  ListStockOpnameQueryDto,
  SetOpnameItemsDto,
  StockOpnameDetailResponse,
  StockOpnameItemResponse,
  StockOpnameListResponse,
  StockOpnameResponse,
  StockOpnameStatusDto,
} from "@/contracts";
import { PrismaService } from "../prisma/prisma.service";

const OPNAME_ITEM_SELECT = {
  id: true,
  stockOpnameId: true,
  productId: true,
  product: { select: { id: true, code: true, name: true } },
  systemStock: true,
  actualStock: true,
  difference: true,
  notes: true,
  createdAt: true,
} satisfies Prisma.StockOpnameItemSelect;

const OPNAME_SELECT = {
  id: true,
  opnameNumber: true,
  branchId: true,
  branch: { select: { id: true, name: true, companyId: true } },
  companyId: true,
  status: true,
  notes: true,
  startedAt: true,
  completedAt: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { items: true } },
} satisfies Prisma.StockOpnameSelect;

const OPNAME_DETAIL_SELECT = {
  ...OPNAME_SELECT,
  items: { select: OPNAME_ITEM_SELECT, orderBy: { createdAt: "asc" } },
} satisfies Prisma.StockOpnameSelect;

type RawOpname = Prisma.StockOpnameGetPayload<{
  select: typeof OPNAME_SELECT;
}>;
type RawOpnameDetail = Prisma.StockOpnameGetPayload<{
  select: typeof OPNAME_DETAIL_SELECT;
}>;
type RawOpnameItem = Prisma.StockOpnameItemGetPayload<{
  select: typeof OPNAME_ITEM_SELECT;
}>;

@Injectable()
export class StockOpnameService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    companyId: string,
    query: ListStockOpnameQueryDto,
  ): Promise<StockOpnameListResponse> {
    const where = this.buildListWhere(companyId, query);

    const [rows, total] = await Promise.all([
      this.prisma.stockOpname.findMany({
        where,
        select: OPNAME_SELECT,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      this.prisma.stockOpname.count({ where }),
    ]);

    return {
      opnames: rows.map(toOpnameResponse),
      total,
      totalPages: Math.ceil(total / query.perPage),
    };
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<StockOpnameDetailResponse> {
    const row = await this.prisma.stockOpname.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: OPNAME_DETAIL_SELECT,
    });
    if (!row) throw new NotFoundException("Stock opname tidak ditemukan");
    return toOpnameDetailResponse(row);
  }

  async create(
    companyId: string,
    userId: string,
    dto: CreateStockOpnameDto,
    retryCount = 0,
  ): Promise<StockOpnameDetailResponse> {
    if (dto.branchId) await this.assertBranch(companyId, dto.branchId);

    const opnameNumber = generateOpnameNumber();

    try {
      const created = await this.prisma.stockOpname.create({
        data: {
          opnameNumber,
          branchId: dto.branchId ?? null,
          companyId,
          status: "DRAFT",
          notes: dto.notes ?? null,
          createdBy: userId,
        },
        select: OPNAME_DETAIL_SELECT,
      });
      return toOpnameDetailResponse(created);
    } catch (err) {
      if (isOpnameNumberConflict(err) && retryCount < 3) {
        return this.create(companyId, userId, dto, retryCount + 1);
      }
      throw err;
    }
  }

  async setItems(
    companyId: string,
    id: string,
    dto: SetOpnameItemsDto,
  ): Promise<StockOpnameDetailResponse> {
    const opname = await this.prisma.stockOpname.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: { id: true, status: true, branchId: true },
    });
    if (!opname) throw new NotFoundException("Stock opname tidak ditemukan");
    if (opname.status !== "DRAFT" && opname.status !== "IN_PROGRESS") {
      throw new BadRequestException(
        "Item opname hanya bisa diubah saat status DRAFT atau IN_PROGRESS",
      );
    }

    const productIds = Array.from(new Set(dto.items.map((it) => it.productId)));
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, companyId, deletedAt: null },
      select: { id: true, stock: true },
    });
    if (products.length !== productIds.length) {
      throw new BadRequestException(
        "Beberapa produk tidak ditemukan atau bukan milik tenant ini",
      );
    }
    const productStockMap = new Map(products.map((p) => [p.id, p.stock]));

    let branchStockMap = new Map<string, number>();
    if (opname.branchId) {
      const branchStocks = await this.prisma.branchStock.findMany({
        where: {
          branchId: opname.branchId,
          productId: { in: productIds },
        },
        select: { productId: true, quantity: true },
      });
      branchStockMap = new Map(
        branchStocks.map((s) => [s.productId, s.quantity]),
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.stockOpnameItem.deleteMany({ where: { stockOpnameId: id } });

      await tx.stockOpnameItem.createMany({
        data: dto.items.map((it) => {
          const systemStock = opname.branchId
            ? (branchStockMap.get(it.productId) ?? 0)
            : (productStockMap.get(it.productId) ?? 0);
          return {
            stockOpnameId: id,
            productId: it.productId,
            systemStock,
            actualStock: it.physicalStock,
            difference: it.physicalStock - systemStock,
            notes: it.notes ?? null,
          };
        }),
      });

      return tx.stockOpname.findUniqueOrThrow({
        where: { id },
        select: OPNAME_DETAIL_SELECT,
      });
    });

    return toOpnameDetailResponse(updated);
  }

  async start(
    companyId: string,
    id: string,
  ): Promise<StockOpnameDetailResponse> {
    const opname = await this.prisma.stockOpname.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: { id: true, status: true },
    });
    if (!opname) throw new NotFoundException("Stock opname tidak ditemukan");
    if (opname.status !== "DRAFT") {
      throw new BadRequestException(
        "Hanya opname dengan status DRAFT yang bisa dimulai",
      );
    }

    await this.prisma.stockOpname.update({
      where: { id },
      data: { status: "IN_PROGRESS", startedAt: new Date() },
    });

    const refreshed = await this.prisma.stockOpname.findUniqueOrThrow({
      where: { id },
      select: OPNAME_DETAIL_SELECT,
    });
    return toOpnameDetailResponse(refreshed);
  }

  async complete(
    companyId: string,
    userId: string,
    id: string,
  ): Promise<StockOpnameDetailResponse> {
    const opname = await this.prisma.stockOpname.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: {
        id: true,
        opnameNumber: true,
        status: true,
        branchId: true,
        items: {
          select: {
            id: true,
            productId: true,
            systemStock: true,
            actualStock: true,
            difference: true,
          },
        },
      },
    });
    if (!opname) throw new NotFoundException("Stock opname tidak ditemukan");
    if (opname.status !== "IN_PROGRESS") {
      throw new BadRequestException(
        "Hanya opname dengan status IN_PROGRESS yang bisa diselesaikan",
      );
    }
    if (opname.items.length === 0) {
      throw new BadRequestException(
        "Opname tidak memiliki item untuk diselesaikan",
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      for (const item of opname.items) {
        if (item.difference === 0) continue;

        let balanceAfter: number;
        if (opname.branchId) {
          const upserted = await tx.branchStock.upsert({
            where: {
              branchId_productId: {
                branchId: opname.branchId,
                productId: item.productId,
              },
            },
            create: {
              branchId: opname.branchId,
              productId: item.productId,
              quantity: item.actualStock,
            },
            update: { quantity: item.actualStock },
            select: { quantity: true },
          });
          balanceAfter = upserted.quantity;
        } else {
          const updatedP = await tx.product.update({
            where: { id: item.productId },
            data: { stock: item.actualStock },
            select: { stock: true },
          });
          balanceAfter = updatedP.stock;
        }

        // difference = actual - system. Positif = stok bertambah (IN),
        // negatif = stok berkurang (OUT).
        const direction: "IN" | "OUT" = item.difference > 0 ? "IN" : "OUT";

        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            branchId: opname.branchId ?? null,
            companyId,
            type: "OPNAME_ADJUSTMENT",
            quantity: Math.abs(item.difference),
            direction,
            balanceAfter,
            refType: "stock_opname",
            refId: id,
            refNumber: opname.opnameNumber,
            note: `Opname ${opname.opnameNumber}`,
            reference: opname.opnameNumber,
            createdBy: userId,
          },
        });
      }

      await tx.stockOpname.update({
        where: { id },
        data: { status: "COMPLETED", completedAt: new Date() },
      });

      return tx.stockOpname.findUniqueOrThrow({
        where: { id },
        select: OPNAME_DETAIL_SELECT,
      });
    });

    return toOpnameDetailResponse(updated);
  }

  async cancel(
    companyId: string,
    id: string,
  ): Promise<StockOpnameDetailResponse> {
    const opname = await this.prisma.stockOpname.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: { id: true, status: true },
    });
    if (!opname) throw new NotFoundException("Stock opname tidak ditemukan");
    if (opname.status !== "DRAFT" && opname.status !== "IN_PROGRESS") {
      throw new BadRequestException(
        "Hanya opname dengan status DRAFT atau IN_PROGRESS yang bisa dibatalkan",
      );
    }

    await this.prisma.stockOpname.update({
      where: { id },
      data: { status: "CANCELLED" },
    });

    const refreshed = await this.prisma.stockOpname.findUniqueOrThrow({
      where: { id },
      select: OPNAME_DETAIL_SELECT,
    });
    return toOpnameDetailResponse(refreshed);
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const existing = await this.prisma.stockOpname.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException("Stock opname tidak ditemukan");
    if (existing.status !== "DRAFT") {
      throw new BadRequestException(
        "Hanya opname dengan status DRAFT yang bisa dihapus",
      );
    }
    await this.prisma.stockOpname.delete({ where: { id } });
    return { success: true };
  }

  private buildListWhere(
    companyId: string,
    query: ListStockOpnameQueryDto,
  ): Prisma.StockOpnameWhereInput {
    const { search, status, branchId, from, to } = query;
    const where: Prisma.StockOpnameWhereInput = this.tenantWhere(companyId);
    if (status) where.status = status;
    if (branchId) where.branchId = branchId;
    if (search) {
      where.opnameNumber = { contains: search, mode: "insensitive" };
    }
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }
    return where;
  }

  private tenantWhere(companyId: string): Prisma.StockOpnameWhereInput {
    return {
      OR: [{ companyId }, { branch: { companyId } }],
    };
  }

  private async assertBranch(companyId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException("Cabang tidak ditemukan");
  }
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function todayCompact(): string {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function randomHex(length: number): string {
  const chars = "0123456789ABCDEF";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function generateOpnameNumber(): string {
  return `OPN-${todayCompact()}-${randomHex(6)}`;
}

function isOpnameNumberConflict(err: unknown): boolean {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    const target = err.meta?.target;
    if (Array.isArray(target) && target.includes("opnameNumber")) return true;
  }
  return false;
}

function toOpnameItemResponse(it: RawOpnameItem): StockOpnameItemResponse {
  return {
    id: it.id,
    stockOpnameId: it.stockOpnameId,
    productId: it.productId,
    product: it.product
      ? { id: it.product.id, code: it.product.code, name: it.product.name }
      : null,
    systemStock: it.systemStock,
    physicalStock: it.actualStock,
    difference: it.difference,
    notes: it.notes,
    createdAt: it.createdAt.toISOString(),
  };
}

function toOpnameResponse(o: RawOpname): StockOpnameResponse {
  return {
    id: o.id,
    opnameNumber: o.opnameNumber,
    branchId: o.branchId,
    branch: o.branch ? { id: o.branch.id, name: o.branch.name } : null,
    status: o.status as StockOpnameStatusDto,
    notes: o.notes,
    startedAt: o.startedAt.toISOString(),
    completedAt: o.completedAt ? o.completedAt.toISOString() : null,
    createdBy: o.createdBy,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    itemCount: o._count.items,
  };
}

function toOpnameDetailResponse(
  o: RawOpnameDetail,
): StockOpnameDetailResponse {
  return {
    ...toOpnameResponse(o),
    items: o.items.map(toOpnameItemResponse),
  };
}
