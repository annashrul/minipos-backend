import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  DashboardAlertsResponse,
  DashboardListQueryDto,
  ExpiringListResponse,
  ExpiringProductResponse,
  LowStockBranchEntry,
  LowStockListResponse,
  LowStockProductResponse,
} from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";

const EXPIRY_WINDOW_DAYS = 30;
const LOW_STOCK_FETCH_CAP = 500;
const ALERTS_LOW_STOCK_FETCH_CAP = 200;

@Injectable()
export class DashboardStockService {
  constructor(private readonly prisma: PrismaService) {}

  async lowStock(
    companyId: string,
    query: DashboardListQueryDto,
  ): Promise<LowStockListResponse> {
    const { branchId, limit } = query;

    const where: Prisma.ProductWhereInput = {
      companyId,
      isActive: true,
      deletedAt: null,
    };

    // Prisma can't compare column-to-column; fetch capped set then filter in-memory.
    const candidates = await this.prisma.product.findMany({
      where,
      select: {
        id: true,
        code: true,
        name: true,
        stock: true,
        minStock: true,
        unit: true,
        categoryId: true,
        category: { select: { name: true } },
        branchStocks: branchId
          ? {
              where: { branchId },
              select: {
                quantity: true,
                minStock: true,
                branchId: true,
                branch: { select: { id: true, name: true } },
              },
            }
          : {
              select: {
                quantity: true,
                minStock: true,
                branchId: true,
                branch: { select: { id: true, name: true } },
              },
              orderBy: { quantity: "asc" },
              take: 5,
            },
      },
      orderBy: { stock: "asc" },
      take: LOW_STOCK_FETCH_CAP,
    });

    const filtered = candidates.filter((p) => p.stock <= p.minStock);
    const items: LowStockProductResponse[] = filtered.slice(0, limit).map((p) => {
      const branchStocks: LowStockBranchEntry[] = p.branchStocks.map((bs) => ({
        branchId: bs.branchId,
        branchName: bs.branch?.name ?? "",
        quantity: bs.quantity,
        minStock: bs.minStock,
      }));
      return {
        productId: p.id,
        code: p.code,
        name: p.name,
        stock: p.stock,
        minStock: p.minStock,
        unit: p.unit,
        categoryId: p.categoryId,
        categoryName: p.category?.name ?? null,
        branchStocks,
      };
    });

    return { items, total: filtered.length };
  }

  async expiring(
    companyId: string,
    query: DashboardListQueryDto,
  ): Promise<ExpiringListResponse> {
    const { limit } = query;
    const now = new Date();
    const cutoff = new Date(now.getTime() + EXPIRY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const baseWhere: Prisma.ProductWhereInput = {
      companyId,
      isActive: true,
      deletedAt: null,
      expiryDate: { gt: now, lte: cutoff },
    };

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where: baseWhere,
        select: {
          id: true,
          code: true,
          name: true,
          stock: true,
          unit: true,
          expiryDate: true,
          categoryId: true,
          category: { select: { name: true } },
        },
        orderBy: { expiryDate: "asc" },
        take: limit,
      }),
      this.prisma.product.count({ where: baseWhere }),
    ]);

    const items: ExpiringProductResponse[] = products.map((p) => {
      const expiry = p.expiryDate as Date;
      const daysToExpiry = Math.ceil(
        (expiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
      );
      return {
        productId: p.id,
        code: p.code,
        name: p.name,
        stock: p.stock,
        unit: p.unit,
        expiryDate: expiry.toISOString(),
        daysToExpiry,
        categoryId: p.categoryId,
        categoryName: p.category?.name ?? null,
      };
    });

    return { items, total };
  }

  async alerts(companyId: string): Promise<DashboardAlertsResponse> {
    const now = new Date();
    const expiryCutoff = new Date(now.getTime() + EXPIRY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const [expiringCount, overdueDebtCount, pendingApprovalCount, candidates] =
      await Promise.all([
        this.prisma.product.count({
          where: {
            companyId,
            isActive: true,
            deletedAt: null,
            expiryDate: { gt: now, lte: expiryCutoff },
          },
        }),
        this.prisma.debt.count({
          where: {
            companyId,
            type: "RECEIVABLE",
            status: { in: ["UNPAID", "PARTIAL", "OVERDUE"] },
            dueDate: { lt: now },
          },
        }),
        this.prisma.approvalRequest.count({
          where: { status: "PENDING", branch: { companyId } },
        }),
        this.prisma.product.findMany({
          where: { companyId, isActive: true, deletedAt: null },
          select: { stock: true, minStock: true },
        }),
      ]);

    const lowStockCount = candidates.filter((p) => p.stock <= p.minStock).length;

    return {
      lowStockCount,
      expiringCount,
      overdueDebtCount,
      pendingApprovalCount,
    };
  }

  async legacyLowStockShape(
    companyId: string,
  ): Promise<
    Array<{
      id: string;
      name: string;
      stock: number;
      minStock: number;
      category: { name: string };
    }>
  > {
    const candidates = await this.prisma.product.findMany({
      where: { companyId, isActive: true, deletedAt: null },
      select: {
        id: true,
        name: true,
        stock: true,
        minStock: true,
        category: { select: { name: true } },
      },
      orderBy: { stock: "asc" },
      take: ALERTS_LOW_STOCK_FETCH_CAP,
    });
    return candidates
      .filter((p) => p.stock <= p.minStock)
      .slice(0, 10)
      .map((p) => ({
        id: p.id,
        name: p.name,
        stock: p.stock,
        minStock: p.minStock,
        category: { name: p.category?.name || "Uncategorized" },
      }));
  }
}
