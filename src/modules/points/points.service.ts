import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  AdjustPointsDto,
  CustomerPointsResponse,
  EarnPointsDto,
  EarnResultResponse,
  ListPointHistoryQueryDto,
  PointHistoryResponse,
  RedeemPointsDto,
  RedeemResultResponse,
} from "./dto/points.dto";
import type { PaginatedResponse } from "../../common/types/response";
import { paginate } from "../../common/utils/pagination";
import { PointsRepository, type RawHistory } from "./points.repository";
import { PrismaService } from "../prisma/prisma.service";

const POINTS_PER_RUPIAH = 10000;
const RUPIAH_PER_POINT = 100;

@Injectable()
export class PointsService {
  constructor(
    private readonly repo: PointsRepository,
    private readonly prisma: PrismaService,
  ) {}

  async getCustomerPoints(
    companyId: string,
    customerId: string,
  ): Promise<CustomerPointsResponse> {
    const customer = await this.assertCustomer(companyId, customerId);

    const [totalEarned, totalRedeemedRaw] = await Promise.all([
      this.repo.aggregatePoints(customerId, "EARN"),
      this.repo.aggregatePoints(customerId, {
        in: ["REDEEM", "EXPIRED"],
      }),
    ]);

    // redeem/expired stored as negative; flip sign for "total redeemed"
    const totalRedeemed = Math.abs(totalRedeemedRaw);

    return {
      customerId: customer.id,
      currentPoints: customer.points,
      totalEarned,
      totalRedeemed,
    };
  }

  async listHistory(
    companyId: string,
    query: ListPointHistoryQueryDto,
  ): Promise<PaginatedResponse<PointHistoryResponse>> {
    const { page, perPage } = query;
    const where: Prisma.CustomerPointHistoryWhereInput = {
      customer: { companyId },
    };
    if (query.customerId) where.customerId = query.customerId;
    if (query.type) where.type = query.type;
    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) where.createdAt.gte = new Date(query.from);
      if (query.to) where.createdAt.lte = new Date(query.to);
    }

    const [rows, total] = await Promise.all([
      this.repo.findManyHistory(where, (page - 1) * perPage, perPage),
      this.repo.countHistory(where),
    ]);

    return paginate(rows.map(toHistoryResponse), total, page, perPage);
  }

  async earn(
    companyId: string,
    dto: EarnPointsDto,
  ): Promise<EarnResultResponse> {
    await this.assertCustomer(companyId, dto.customerId);

    return this.prisma.$transaction(async (tx) => {
      const earned = Math.floor(dto.amount / POINTS_PER_RUPIAH);

      await tx.customer.update({
        where: { id: dto.customerId },
        data: {
          points: { increment: earned },
          totalSpending: { increment: dto.amount },
        },
      });

      if (earned > 0) {
        await tx.customerPointHistory.create({
          data: {
            customerId: dto.customerId,
            points: earned,
            type: "EARN",
            reference: dto.reference ?? null,
            description: dto.description ?? null,
          },
        });
      }

      return { earned };
    });
  }

  async redeem(
    companyId: string,
    dto: RedeemPointsDto,
  ): Promise<RedeemResultResponse> {
    const customer = await this.assertCustomer(companyId, dto.customerId);
    if (customer.points < dto.points) {
      throw new BadRequestException(
        `Point tidak mencukupi (saldo: ${customer.points}, butuh: ${dto.points})`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id: dto.customerId },
        data: { points: { decrement: dto.points } },
      });

      await tx.customerPointHistory.create({
        data: {
          customerId: dto.customerId,
          points: -dto.points,
          type: "REDEEM",
          reference: dto.reference ?? null,
          description: dto.description ?? null,
        },
      });

      return { valueIDR: dto.points * RUPIAH_PER_POINT };
    });
  }

  async adjust(
    companyId: string,
    dto: AdjustPointsDto,
  ): Promise<CustomerPointsResponse> {
    const customer = await this.assertCustomer(companyId, dto.customerId);

    if (dto.delta < 0 && customer.points + dto.delta < 0) {
      throw new BadRequestException(
        `Penyesuaian akan membuat saldo point negatif (saldo: ${customer.points}, delta: ${dto.delta})`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id: dto.customerId },
        data: { points: { increment: dto.delta } },
      });

      await tx.customerPointHistory.create({
        data: {
          customerId: dto.customerId,
          points: dto.delta,
          type: "ADJUST",
          reference: null,
          description: dto.description,
        },
      });
    });

    return this.getCustomerPoints(companyId, dto.customerId);
  }

  async earnFromTransaction(
    tx: Prisma.TransactionClient,
    params: { customerId: string; amount: number; invoiceNumber: string },
  ): Promise<{ earned: number }> {
    const earned = Math.floor(params.amount / POINTS_PER_RUPIAH);

    await tx.customer.update({
      where: { id: params.customerId },
      data: {
        points: { increment: earned },
        totalSpending: { increment: params.amount },
      },
    });

    if (earned > 0) {
      await tx.customerPointHistory.create({
        data: {
          customerId: params.customerId,
          points: earned,
          type: "EARN",
          reference: params.invoiceNumber,
          description: `Earn dari transaksi ${params.invoiceNumber}`,
        },
      });
    }

    return { earned };
  }

  async redeemForTransaction(
    tx: Prisma.TransactionClient,
    params: { customerId: string; points: number; invoiceNumber: string },
  ): Promise<{ valueIDR: number }> {
    const customer = await tx.customer.findUnique({
      where: { id: params.customerId },
      select: { id: true, points: true },
    });
    if (!customer) throw new NotFoundException("Customer not found");
    if (customer.points < params.points) {
      throw new BadRequestException(
        `Point tidak mencukupi (saldo: ${customer.points}, butuh: ${params.points})`,
      );
    }

    await tx.customer.update({
      where: { id: params.customerId },
      data: { points: { decrement: params.points } },
    });

    await tx.customerPointHistory.create({
      data: {
        customerId: params.customerId,
        points: -params.points,
        type: "REDEEM",
        reference: params.invoiceNumber,
        description: `Redeem untuk transaksi ${params.invoiceNumber}`,
      },
    });

    return { valueIDR: params.points * RUPIAH_PER_POINT };
  }

  private async assertCustomer(companyId: string, customerId: string) {
    const customer = await this.repo.findCustomer(companyId, customerId);
    if (!customer) throw new NotFoundException("Customer not found");
    return customer;
  }
}

function toHistoryResponse(h: RawHistory): PointHistoryResponse {
  return {
    id: h.id,
    customerId: h.customerId,
    points: h.points,
    type: h.type,
    reference: h.reference,
    description: h.description,
    createdAt: h.createdAt.toISOString(),
  };
}
