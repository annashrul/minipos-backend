import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { CreateReturnDto, ReturnDetailResponse } from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";
import {
  generateReturnNumber,
  isReturnNumberConflict,
} from "./returns.helpers";
import { toReturnDetailResponse } from "./returns.mapper";
import { RETURN_DETAIL_SELECT } from "./returns.select";

const MAX_RETURN_NUMBER_RETRIES = 3;

type PurchasedItem = {
  quantity: number;
  unitPrice: number;
  productName: string;
};

@Injectable()
export class ReturnCreateService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    companyId: string,
    userId: string,
    dto: CreateReturnDto,
  ): Promise<ReturnDetailResponse> {
    if (dto.branchId) await this.assertBranch(companyId, dto.branchId);

    const transaction = await this.loadTransaction(companyId, dto.transactionId);
    const purchasedMap = aggregatePurchased(transaction.items);
    const priorMap = await this.loadPriorReturned(dto.transactionId);

    this.validateRequest(dto, purchasedMap, priorMap);
    await this.validateExchangeProducts(companyId, dto);

    const totalRefund = computeTotalRefund(dto);
    const branchId = dto.branchId ?? transaction.branchId ?? null;
    const customerId = transaction.customerId ?? null;

    return this.persistWithRetry(dto, {
      userId,
      branchId,
      customerId,
      totalRefund,
      purchasedMap,
    });
  }

  private async loadTransaction(companyId: string, transactionId: string) {
    const transaction = await this.prisma.transaction.findFirst({
      where: {
        id: transactionId,
        user: { companyId },
      },
      select: {
        id: true,
        invoiceNumber: true,
        customerId: true,
        branchId: true,
        items: {
          select: {
            productId: true,
            quantity: true,
            unitPrice: true,
            productName: true,
          },
        },
      },
    });
    if (!transaction) {
      throw new NotFoundException("Transaksi tidak ditemukan");
    }
    return transaction;
  }

  private async loadPriorReturned(
    transactionId: string,
  ): Promise<Map<string, number>> {
    const prior = await this.prisma.returnExchangeItem.groupBy({
      by: ["productId"],
      where: {
        returnExchange: {
          transactionId,
          status: { in: ["PENDING", "APPROVED", "COMPLETED"] },
        },
      },
      _sum: { quantity: true },
    });
    return new Map(prior.map((p) => [p.productId, p._sum.quantity ?? 0]));
  }

  private validateRequest(
    dto: CreateReturnDto,
    purchasedMap: Map<string, PurchasedItem>,
    priorMap: Map<string, number>,
  ): void {
    const aggregatedRequest = new Map<string, number>();
    for (const item of dto.items) {
      aggregatedRequest.set(
        item.productId,
        (aggregatedRequest.get(item.productId) ?? 0) + item.quantity,
      );
    }
    for (const [productId, qty] of aggregatedRequest) {
      const purchased = purchasedMap.get(productId);
      if (!purchased) {
        throw new BadRequestException(
          `Produk ${productId} tidak ditemukan pada transaksi`,
        );
      }
      const priorQty = priorMap.get(productId) ?? 0;
      const remaining = purchased.quantity - priorQty;
      if (qty > remaining) {
        throw new BadRequestException(
          `Jumlah retur produk ${purchased.productName} melebihi sisa yang dapat diretur (sisa: ${remaining})`,
        );
      }
    }
  }

  private async validateExchangeProducts(
    companyId: string,
    dto: CreateReturnDto,
  ): Promise<void> {
    const exchangeProductIds = Array.from(
      new Set(
        dto.items
          .map((i) => i.exchangeProductId)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    if (exchangeProductIds.length === 0) return;

    const found = await this.prisma.product.findMany({
      where: { id: { in: exchangeProductIds }, companyId },
      select: { id: true },
    });
    if (found.length !== exchangeProductIds.length) {
      throw new BadRequestException(
        "Salah satu produk pengganti tidak ditemukan",
      );
    }
  }

  private async persistWithRetry(
    dto: CreateReturnDto,
    ctx: {
      userId: string;
      branchId: string | null;
      customerId: string | null;
      totalRefund: number;
      purchasedMap: Map<string, PurchasedItem>;
    },
  ): Promise<ReturnDetailResponse> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < MAX_RETURN_NUMBER_RETRIES; attempt++) {
      const returnNumber = generateReturnNumber();
      try {
        const created = await this.prisma.$transaction(async (tx) => {
          const ret = await tx.returnExchange.create({
            data: {
              returnNumber,
              transactionId: dto.transactionId,
              customerId: ctx.customerId,
              type: dto.type,
              status: "PENDING",
              reason: dto.reason,
              notes: dto.notes ?? null,
              totalRefund: ctx.totalRefund,
              refundMethod: dto.refundMethod ?? null,
              branchId: ctx.branchId,
              processedBy: ctx.userId,
              items: {
                create: dto.items.map((item) => ({
                  productId: item.productId,
                  productName:
                    ctx.purchasedMap.get(item.productId)?.productName ?? "",
                  quantity: item.quantity,
                  unitPrice: item.unitPrice,
                  subtotal: item.subtotal,
                  exchangeProductId: item.exchangeProductId ?? null,
                  exchangeQuantity: item.exchangeQuantity ?? null,
                })),
              },
            },
            select: { id: true },
          });

          return tx.returnExchange.findUniqueOrThrow({
            where: { id: ret.id },
            select: RETURN_DETAIL_SELECT,
          });
        });
        return toReturnDetailResponse(created);
      } catch (err) {
        if (
          isReturnNumberConflict(err) &&
          attempt < MAX_RETURN_NUMBER_RETRIES - 1
        ) {
          lastError = err;
          continue;
        }
        if (isReturnNumberConflict(err)) {
          throw new ConflictException("Nomor retur bentrok, coba lagi");
        }
        throw err;
      }
    }
    if (lastError) {
      throw new ConflictException("Nomor retur bentrok, coba lagi");
    }
    throw new ConflictException("Gagal membuat retur");
  }

  private async assertBranch(companyId: string, branchId: string): Promise<void> {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, companyId },
      select: { id: true },
    });
    if (!branch) throw new NotFoundException("Branch not found");
  }
}

function aggregatePurchased(
  items: Array<{
    productId: string;
    quantity: number;
    unitPrice: number;
    productName: string;
  }>,
): Map<string, PurchasedItem> {
  const map = new Map<string, PurchasedItem>();
  for (const it of items) {
    const existing = map.get(it.productId);
    if (existing) {
      existing.quantity += it.quantity;
    } else {
      map.set(it.productId, {
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        productName: it.productName,
      });
    }
  }
  return map;
}

function computeTotalRefund(dto: CreateReturnDto): number {
  const returnedSum = dto.items.reduce((s, i) => s + i.subtotal, 0);
  if (dto.type === "RETURN") return returnedSum;

  const exchangeSum = dto.items.reduce((s, i) => {
    if (!i.exchangeProductId) return s;
    const sub =
      i.exchangeSubtotal ??
      (i.exchangeQuantity && i.exchangeUnitPrice
        ? i.exchangeQuantity * i.exchangeUnitPrice
        : 0);
    return s + sub;
  }, 0);

  return Math.max(returnedSum - exchangeSum, 0);
}
