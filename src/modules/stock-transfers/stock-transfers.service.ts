import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AssertService } from "@/common/assert/assert.service";
import type { PaginatedResponse } from "@/common/types/response";
import { paginate } from "@/common/utils/pagination";
import type {
  CreateStockTransferDto,
  ListStockTransfersQueryDto,
  ReceiveStockTransferDto,
  StockTransferDetailResponse,
  StockTransferItemResponse,
  StockTransferResponse,
  StockTransferStatusDto,
} from "./dto/stock-transfers.dto";
import {
  dayRange,
  nextDocumentNumber,
} from "@/common/utils/document-number";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { tenantWhere } from "@/common/utils/tenant";
import {
  StockTransfersRepository,
  TRANSFER_DETAIL_SELECT,
  type RawTransfer,
  type RawTransferDetail,
  type RawTransferItem,
} from "./stock-transfers.repository";

@Injectable()
export class StockTransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: StockTransfersRepository,
    private readonly assert: AssertService,
  ) {}

  async list(
    companyId: string,
    query: ListStockTransfersQueryDto,
  ): Promise<PaginatedResponse<StockTransferResponse>> {
    const where = this.buildListWhere(companyId, query);
    const { page, perPage } = query;

    const [rows, total] = await Promise.all([
      this.repo.findMany(where, (page - 1) * perPage, perPage),
      this.repo.count(where),
    ]);

    return paginate(rows.map(toTransferResponse), total, page, perPage);
  }

  async summary(companyId: string, branchId?: string) {
    const where: Prisma.StockTransferWhereInput = tenantWhere(companyId, "direct", "fromBranch", "toBranch");
    if (branchId) {
      where.AND = [
        { OR: [{ fromBranchId: branchId }, { toBranchId: branchId }] },
      ];
    }

    const grouped = await this.repo.groupByStatus(where);

    const map = new Map(grouped.map((g) => [g.status, g._count._all]));
    return {
      total: grouped.reduce((s, g) => s + g._count._all, 0),
      pending: map.get("PENDING") ?? 0,
      approved: map.get("APPROVED") ?? 0,
      inTransit: map.get("IN_TRANSIT") ?? 0,
      received: map.get("RECEIVED") ?? 0,
      rejected: map.get("REJECTED") ?? 0,
    };
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<StockTransferDetailResponse> {
    const row = await this.repo.findOne({
      id,
      ...tenantWhere(companyId, "direct", "fromBranch", "toBranch"),
    });
    if (!row) throw new NotFoundException("Stock transfer tidak ditemukan");
    const productMap = await this.repo.findProductDetails(row.items);
    return toTransferDetailResponse(row, productMap);
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
    await this.assert.branch(companyId, dto.fromBranchId);
    await this.assert.branch(companyId, dto.toBranchId);

    // Validate products belong to company and gather names
    const productIds = Array.from(new Set(dto.items.map((it) => it.productId)));
    const products = await this.repo.findProducts(productIds, companyId);
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

      const productMap = await this.repo.findProductDetails(created.items);
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
    const transfer = await this.repo.findForSend({
      id,
      ...tenantWhere(companyId, "direct", "fromBranch", "toBranch"),
    });
    if (!transfer) throw new NotFoundException("Stock transfer tidak ditemukan");
    if (transfer.status !== "PENDING") {
      throw new BadRequestException(
        "Hanya transfer dengan status PENDING yang bisa dikirim",
      );
    }

    // Validate stock availability at source branch
    const productIds = transfer.items.map((it) => it.productId);
    const stocks = await this.repo.findBranchStocks(transfer.fromBranchId, productIds);
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

    const productMap = await this.repo.findProductDetails(updated.items);
    return toTransferDetailResponse(updated, productMap);
  }

  async receive(
    companyId: string,
    userId: string,
    id: string,
    dto: ReceiveStockTransferDto,
  ): Promise<StockTransferDetailResponse> {
    const transfer = await this.repo.findForReceive({
      id,
      ...tenantWhere(companyId, "direct", "fromBranch", "toBranch"),
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

    const productMap = await this.repo.findProductDetails(updated.items);
    return toTransferDetailResponse(updated, productMap);
  }

  async cancel(
    companyId: string,
    userId: string,
    id: string,
  ): Promise<StockTransferDetailResponse> {
    const transfer = await this.repo.findForCancel({
      id,
      ...tenantWhere(companyId, "direct", "fromBranch", "toBranch"),
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

    const productMap = await this.repo.findProductDetails(updated.items);
    return toTransferDetailResponse(updated, productMap);
  }

  async delete(companyId: string, id: string): Promise<{ success: true }> {
    const existing = await this.repo.findStatus({
      id,
      ...tenantWhere(companyId, "direct", "fromBranch", "toBranch"),
    });
    if (!existing) throw new NotFoundException("Stock transfer tidak ditemukan");
    if (existing.status !== "PENDING") {
      throw new BadRequestException(
        "Hanya transfer dengan status PENDING yang bisa dihapus",
      );
    }
    await this.repo.delete(id);
    return { success: true };
  }

  private buildListWhere(
    companyId: string,
    query: ListStockTransfersQueryDto,
  ): Prisma.StockTransferWhereInput {
    const { search, status, branchId, fromBranchId, toBranchId, from, to } = query;
    const where: Prisma.StockTransferWhereInput = tenantWhere(companyId, "direct", "fromBranch", "toBranch");
    if (status) where.status = status;
    if (branchId) {
      where.AND = [
        { OR: [{ fromBranchId: branchId }, { toBranchId: branchId }] },
      ];
    }
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

  // TR-YYYYMMDD-NNNN -- sequence per company per hari (shared utility).
  private async nextTransferNumber(companyId: string): Promise<string> {
    const { start, end } = dayRange();
    return nextDocumentNumber({
      prefix: "TR",
      countToday: () => this.repo.countForNumber(companyId, start, end),
      exists: (candidate) => this.repo.existsByNumber(companyId, candidate),
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
