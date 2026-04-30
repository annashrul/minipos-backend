import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  ClosingReportListResponse,
  ClosingReportResponse,
  ListClosingReportsQueryDto,
} from "@/contracts";
import { PrismaService } from "../../prisma/prisma.service";
import {
  CLOSING_REPORT_SELECT,
  tenantWhere,
  toClosingReportResponse,
} from "./closing-reports.shared";

@Injectable()
export class ClosingReportsQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    companyId: string,
    query: ListClosingReportsQueryDto,
  ): Promise<ClosingReportListResponse> {
    const { search, branchId, cashierUserId, from, to, page, perPage } = query;

    const where: Prisma.ClosingReportWhereInput = tenantWhere(companyId);
    if (branchId) where.branchId = branchId;
    if (cashierUserId) where.cashierUserId = cashierUserId;
    if (search) {
      where.cashierName = { contains: search, mode: "insensitive" };
    }
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from);
      if (to) where.date.lte = new Date(to);
    }

    const [rows, total] = await Promise.all([
      this.prisma.closingReport.findMany({
        where,
        select: CLOSING_REPORT_SELECT,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.closingReport.count({ where }),
    ]);

    return {
      reports: rows.map(toClosingReportResponse),
      total,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async findById(
    companyId: string,
    id: string,
  ): Promise<ClosingReportResponse> {
    const report = await this.prisma.closingReport.findFirst({
      where: { id, ...tenantWhere(companyId) },
      select: CLOSING_REPORT_SELECT,
    });
    if (!report) throw new NotFoundException("Closing report not found");
    return toClosingReportResponse(report);
  }

  async findByShift(
    companyId: string,
    shiftId: string,
  ): Promise<ClosingReportResponse | null> {
    const report = await this.prisma.closingReport.findFirst({
      where: { shiftId, ...tenantWhere(companyId) },
      select: CLOSING_REPORT_SELECT,
    });
    return report ? toClosingReportResponse(report) : null;
  }
}
