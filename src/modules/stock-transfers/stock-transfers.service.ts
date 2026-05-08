import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  CreateStockTransferDto,
  ListStockTransfersQueryDto,
  ReceiveStockTransferDto,
  StockTransferDetailResponse,
  StockTransferItemResponse,
  StockTransferListResponse,
  StockTransferResponse,
  StockTransferStatusDto,
} from "@/contracts";
import {
  dayRange,
  nextDocumentNumber,
} from "@/common/utils/document-number";
import { PrismaService } from "../prisma/prisma.service";

const TRANSFER_ITEM_SELECT = {
  id: true,
  stockTransferId: true,
  productId: true,
  productName: true,
  quantity: true,
  receivedQty: true,
  createdAt: true,
} satisfies Prisma.StockTransferItemSelect;

const TRANSFER_SELECT = {
  id: true,
  transferNumber: true,
  fromBranchId: true,
  fromBranch: { select: { id: true, name: true, companyId: true } },
  toBranchId: true,
  toBranch: { select: { id: true, name: true, companyId: true } },
  companyId: true,
  status: true,
  notes: true,
  requestedBy: true,
  approvedBy: true,
  requestedAt: true,
  approvedAt: true,
  receivedAt: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { items: true } },
} satisfies Prisma.StockTransferSelect;

const TRANSFER_DETAIL_SELECT = {
  ...TRANSFER_SELECT,
  items: { select: TRANSFER_ITEM_SELECT, orderBy: { createdAt: "asc" } },
} satisfies Prisma.StockTransferSelect;

type RawTransfer = Prisma.StockTransferGetPayload<{
  select: typeof TRANSFER_SELECT;
}>;
type RawTransferDetail = Prisma.StockTransferGetPayload<{
  select: typeof TRANSFER_DETAIL_SELECT;
}>;
type RawTransferItem = Prisma.StockTransferItemGetPayload<{
  select: typeof TRANSFER_ITEM_SELECT;
}>;

@Injectable()
export class StockTransfersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    companyId: string,
    query: ListStockTransfersQueryDto,
  ): Promise<StockTransferListResponse> {
    const where = this.buildListWhere(companyId, query);

    const [rows, total] = await Promise.all([
      this.prisma.stockTransfer.findMany({
        where,
        select: TRANSFER_SELECT,
        orderBy: { requestedAt: "desc" },
        skip: (query.page - 1) * query.perPage,
        take: query.perPage,
      }),
      this.prisma.stockTransfer.count({ where }),
    ]);

    return {
      transfers: rows.map(toTransferResponse),
      total,
      totalPages: Math.ceil(total / query.perPage),
    };
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<StockTransferDetailResponse> {
    const row = await this.prisma.stockTransfer.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: TRANSFER_DETAIL_SELECT,
    });
    if (!row) throw new NotFoundException("Stock transfer tidak ditemukan");
    const productMap = await this.loadProductMap(row.items);
    return toTransferDetailResponse(row, productMap);
  }

  private async loadProductMap(
    items: { productId: string }[],
  ): Promise<Map<string, { id: string; code: string; name: string }>> {
    const ids = Array.from(new Set(items.map((it) => it.productId)));
    if (ids.length === 0) return new Map();
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, code: true, name: true },
    });
    return new Map(products.map((p) => [p.id, p]));
  }

  async create(
    companyId: string,
    userId: string,
    dto: CreateStockTransferDto,
    retryCount = 0,
  ): Promise<StockTransferDetailResponse> {
    if (dto.fromBranchId === dto.toBranchId) {
      throw new BadRequestException(
        "Cabang asal dan tujuan tidak boleh sama",
      );
    }
    await this.assertBranch(companyId, dto.fromBranchId);
    await this.assertBranch(companyId, dto.toBranchId);

    // Validate products belong to company and gather names
    const productIds = Array.from(new Set(dto.items.map((it) => it.productId)));
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, companyId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (products.length !== productIds.length) {
      throw new BadRequestException(
        "Beberapa produk tidak ditemukan atau bukan milik tenant ini",
      );
    }
    const nameMap = new Map(products.map((p) => [p.id, p.name]));

    const transferNumber = await this.nextTransferNumber(companyId);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const transfer = await tx.stockTransfer.create({
          data: {
            transferNumber,
            fromBranchId: dto.fromBranchId,
            toBranchId: dto.toBranchId,
            companyId,
            status: "PENDING",
            notes: dto.notes ?? null,
            requestedBy: userId,
            items: {
              create: dto.items.map((it) => ({
                productId: it.productId,
                productName: nameMap.get(it.productId) ?? "",
                quantity: it.quantity,
              })),
            },
          },
          select: { id: true },
        });

        return tx.stockTransfer.findUniqueOrThrow({
          where: { id: transfer.id },
          select: TRANSFER_DETAIL_SELECT,
        });
      });

      const productMap = await this.loadProductMap(created.items);
      return toTransferDetailResponse(created, productMap);
    } catch (err) {
      if (isTransferNumberConflict(err) && retryCount < 3) {
        return this.create(companyId, userId, dto, retryCount + 1);
      }
      throw err;
    }
  }

  async send(
    companyId: string,
    userId: string,
    id: string,
  ): Promise<StockTransferDetailResponse> {
    const transfer = await this.prisma.stockTransfer.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: {
        id: true,
        transferNumber: true,
        status: true,
        fromBranchId: true,
        items: {
          select: { productId: true, productName: true, quantity: true },
        },
      },
    });
    if (!transfer) throw new NotFoundException("Stock transfer tidak ditemukan");
    if (transfer.status !== "PENDING") {
      throw new BadRequestException(
        "Hanya transfer dengan status PENDING yang bisa dikirim",
      );
    }

    // Validate stock availability at source branch
    const productIds = transfer.items.map((it) => it.productId);
    const stocks = await this.prisma.branchStock.findMany({
      where: {
        branchId: transfer.fromBranchId,
        productId: { in: productIds },
      },
      select: { productId: true, quantity: true },
    });
    const stockMap = new Map(stocks.map((s) => [s.productId, s.quantity]));
    for (const item of transfer.items) {
      const available = stockMap.get(item.productId) ?? 0;
      if (available < item.quantity) {
        throw new BadRequestException(
          `Stok tidak mencukupi untuk produk ${item.productName} (tersedia: ${available}, dibutuhkan: ${item.quantity})`,
        );
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      for (const item of transfer.items) {
        const updatedStock = await tx.branchStock.update({
          where: {
            branchId_productId: {
              branchId: transfer.fromBranchId,
              productId: item.productId,
            },
          },
          data: { quantity: { decrement: item.quantity } },
          select: { quantity: true },
        });

        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            branchId: transfer.fromBranchId,
            companyId,
            type: "TRANSFER_OUT",
            quantity: item.quantity,
            direction: "OUT",
            balanceAfter: updatedStock.quantity,
            refType: "stock_transfer",
            refId: id,
            refNumber: transfer.transferNumber,
            note: `Transfer keluar ${transfer.transferNumber}`,
            reference: transfer.transferNumber,
            createdBy: userId,
          },
        });
      }

      await tx.stockTransfer.update({
        where: { id },
        data: {
          status: "IN_TRANSIT",
          approvedBy: userId,
          approvedAt: new Date(),
        },
      });

      return tx.stockTransfer.findUniqueOrThrow({
        where: { id },
        select: TRANSFER_DETAIL_SELECT,
      });
    });

    const productMap = await this.loadProductMap(updated.items);
    return toTransferDetailResponse(updated, productMap);
  }

  async receive(
    companyId: string,
    userId: string,
    id: string,
    dto: ReceiveStockTransferDto,
  ): Promise<StockTransferDetailResponse> {
    const transfer = await this.prisma.stockTransfer.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: {
        id: true,
        transferNumber: true,
        status: true,
        toBranchId: true,
        items: {
          select: {
            id: true,
            productId: true,
            productName: true,
            quantity: true,
            receivedQty: true,
          },
        },
      },
    });
    if (!transfer) throw new NotFoundException("Stock transfer tidak ditemukan");
    if (transfer.status !== "IN_TRANSIT") {
      throw new BadRequestException(
        "Hanya transfer dengan status IN_TRANSIT yang bisa diterima",
      );
    }

    const itemMap = new Map(transfer.items.map((it) => [it.productId, it]));
    for (const input of dto.items) {
      const item = itemMap.get(input.productId);
      if (!item) {
        throw new BadRequestException(
          `Produk ${input.productId} tidak terdapat pada transfer`,
        );
      }
      if (input.receivedQuantity > item.quantity) {
        throw new BadRequestException(
          `Jumlah diterima untuk produk ${item.productName} melebihi yang dikirim (dikirim: ${item.quantity}, diterima: ${input.receivedQuantity})`,
        );
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      for (const input of dto.items) {
        const item = itemMap.get(input.productId);
        if (!item) continue;

        await tx.stockTransferItem.update({
          where: { id: item.id },
          data: { receivedQty: input.receivedQuantity },
        });

        if (input.receivedQuantity > 0) {
          const upserted = await tx.branchStock.upsert({
            where: {
              branchId_productId: {
                branchId: transfer.toBranchId,
                productId: input.productId,
              },
            },
            create: {
              branchId: transfer.toBranchId,
              productId: input.productId,
              quantity: input.receivedQuantity,
            },
            update: { quantity: { increment: input.receivedQuantity } },
            select: { quantity: true },
          });

          await tx.stockMovement.create({
            data: {
              productId: input.productId,
              branchId: transfer.toBranchId,
              companyId,
              type: "TRANSFER_IN",
              quantity: input.receivedQuantity,
              direction: "IN",
              balanceAfter: upserted.quantity,
              refType: "stock_transfer",
              refId: id,
              refNumber: transfer.transferNumber,
              note: `Transfer masuk ${transfer.transferNumber}`,
              reference: transfer.transferNumber,
              createdBy: userId,
            },
          });
        }
      }

      const data: Prisma.StockTransferUpdateInput = {
        status: "RECEIVED",
        receivedAt: new Date(),
      };
      if (dto.notes !== undefined) data.notes = dto.notes;

      await tx.stockTransfer.update({ where: { id }, data });

      return tx.stockTransfer.findUniqueOrThrow({
        where: { id },
        select: TRANSFER_DETAIL_SELECT,
      });
    });

    const productMap = await this.loadProductMap(updated.items);
    return toTransferDetailResponse(updated, productMap);
  }

  async cancel(
    companyId: string,
    userId: string,
    id: string,
  ): Promise<StockTransferDetailResponse> {
    const transfer = await this.prisma.stockTransfer.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: {
        id: true,
        transferNumber: true,
        status: true,
        fromBranchId: true,
        items: {
          select: { productId: true, productName: true, quantity: true },
        },
      },
    });
    if (!transfer) throw new NotFoundException("Stock transfer tidak ditemukan");
    if (transfer.status !== "PENDING" && transfer.status !== "IN_TRANSIT") {
      throw new BadRequestException(
        "Hanya transfer dengan status PENDING atau IN_TRANSIT yang bisa dibatalkan",
      );
    }

    const wasInTransit = transfer.status === "IN_TRANSIT";

    const updated = await this.prisma.$transaction(async (tx) => {
      if (wasInTransit) {
        for (const item of transfer.items) {
          const upserted = await tx.branchStock.upsert({
            where: {
              branchId_productId: {
                branchId: transfer.fromBranchId,
                productId: item.productId,
              },
            },
            create: {
              branchId: transfer.fromBranchId,
              productId: item.productId,
              quantity: item.quantity,
            },
            update: { quantity: { increment: item.quantity } },
            select: { quantity: true },
          });

          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              branchId: transfer.fromBranchId,
              companyId,
              type: "TRANSFER_IN",
              quantity: item.quantity,
              direction: "IN",
              balanceAfter: upserted.quantity,
              refType: "stock_transfer",
              refId: id,
              refNumber: transfer.transferNumber,
              note: `Pembatalan transfer ${transfer.transferNumber} (rollback)`,
              reference: transfer.transferNumber,
              createdBy: userId,
            },
          });
        }
      }

      await tx.stockTransfer.update({
        where: { id },
        data: { status: "REJECTED" },
      });

      return tx.stockTransfer.findUniqueOrThrow({
        where: { id },
        select: TRANSFER_DETAIL_SELECT,
      });
    });

    const productMap = await this.loadProductMap(updated.items);
    return toTransferDetailResponse(updated, productMap);
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const existing = await this.prisma.stockTransfer.findFirst({
      where: { id, ...this.tenantWhere(companyId) },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException("Stock transfer tidak ditemukan");
    if (existing.status !== "PENDING") {
      throw new BadRequestException(
        "Hanya transfer dengan status PENDING yang bisa dihapus",
      );
    }
    await this.prisma.stockTransfer.delete({ where: { id } });
    return { success: true };
  }

  private buildListWhere(
    companyId: string,
    query: ListStockTransfersQueryDto,
  ): Prisma.StockTransferWhereInput {
    const { search, status, fromBranchId, toBranchId, from, to } = query;
    const where: Prisma.StockTransferWhereInput = this.tenantWhere(companyId);
    if (status) where.status = status;
    if (fromBranchId) where.fromBranchId = fromBranchId;
    if (toBranchId) where.toBranchId = toBranchId;
    if (search) {
      where.transferNumber = { contains: search, mode: "insensitive" };
    }
    if (from || to) {
      where.requestedAt = {};
      if (from) where.requestedAt.gte = new Date(from);
      if (to) where.requestedAt.lte = new Date(to);
    }
    return where;
  }

  private tenantWhere(companyId: string): Prisma.StockTransferWhereInput {
    return {
      OR: [
        { companyId },
        { fromBranch: { companyId } },
        { toBranch: { companyId } },
      ],
    };
  }

  private async assertBranch(companyId: string, branchId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException("Cabang tidak ditemukan");
  }

  // TR-YYYYMMDD-NNNN — sequence per company per hari (shared utility).
  private async nextTransferNumber(companyId: string): Promise<string> {
    const { start, end } = dayRange();
    return nextDocumentNumber({
      prefix: "TR",
      countToday: () =>
        this.prisma.stockTransfer.count({
          where: { companyId, createdAt: { gte: start, lt: end } },
        }),
      exists: async (candidate) => {
        const found = await this.prisma.stockTransfer.findFirst({
          where: { companyId, transferNumber: candidate },
          select: { id: true },
        });
        return !!found;
      },
    });
  }
}

function isTransferNumberConflict(err: unknown): boolean {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002"
  ) {
    const target = err.meta?.target;
    if (Array.isArray(target) && target.includes("transferNumber")) return true;
  }
  return false;
}

function toTransferItemResponse(
  it: RawTransferItem,
  productMap: Map<string, { id: string; code: string; name: string }>,
): StockTransferItemResponse {
  const product = productMap.get(it.productId) ?? null;
  return {
    id: it.id,
    stockTransferId: it.stockTransferId,
    productId: it.productId,
    productName: it.productName,
    product,
    quantity: it.quantity,
    receivedQty: it.receivedQty,
    createdAt: it.createdAt.toISOString(),
  };
}

function toTransferResponse(t: RawTransfer): StockTransferResponse {
  return {
    id: t.id,
    transferNumber: t.transferNumber,
    fromBranchId: t.fromBranchId,
    fromBranch: t.fromBranch
      ? { id: t.fromBranch.id, name: t.fromBranch.name }
      : null,
    toBranchId: t.toBranchId,
    toBranch: t.toBranch ? { id: t.toBranch.id, name: t.toBranch.name } : null,
    status: t.status as StockTransferStatusDto,
    notes: t.notes,
    requestedBy: t.requestedBy,
    approvedBy: t.approvedBy,
    requestedAt: t.requestedAt.toISOString(),
    approvedAt: t.approvedAt ? t.approvedAt.toISOString() : null,
    receivedAt: t.receivedAt ? t.receivedAt.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    itemCount: t._count.items,
  };
}

function toTransferDetailResponse(
  t: RawTransferDetail,
  productMap: Map<string, { id: string; code: string; name: string }>,
): StockTransferDetailResponse {
  return {
    ...toTransferResponse(t),
    items: t.items.map((it) => toTransferItemResponse(it, productMap)),
  };
}
