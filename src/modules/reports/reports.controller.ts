import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import {
  AgingReportQuerySchema,
  CustomerReportQuerySchema,
  PaymentMethodReportQuerySchema,
  ProductReportQuerySchema,
  ProfitLossReportQuerySchema,
  SalesReportQuerySchema,
  type AgingReportQueryDto,
  type CustomerReportQueryDto,
  type PaymentMethodReportQueryDto,
  type ProductReportQueryDto,
  type ProfitLossReportQueryDto,
  type SalesReportQueryDto,
} from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { ReportsService } from "./reports.service";

@Controller("reports")
@UseGuards(AccessGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get("sales")
  @RequireAccess("reports", "view")
  async sales(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(SalesReportQuerySchema))
    query: SalesReportQueryDto,
  ) {
    const data = await this.reports.sales(companyId, query);
    return { data };
  }

  @Get("products")
  @RequireAccess("reports", "view")
  async products(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ProductReportQuerySchema))
    query: ProductReportQueryDto,
  ) {
    const data = await this.reports.products(companyId, query);
    return { data };
  }

  @Get("customers")
  @RequireAccess("reports", "view")
  async customers(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(CustomerReportQuerySchema))
    query: CustomerReportQueryDto,
  ) {
    const data = await this.reports.customers(companyId, query);
    return { data };
  }

  @Get("payment-methods")
  @RequireAccess("reports", "view")
  async paymentMethods(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(PaymentMethodReportQuerySchema))
    query: PaymentMethodReportQueryDto,
  ) {
    const data = await this.reports.paymentMethods(companyId, query);
    return { data };
  }

  @Get("aging")
  @RequireAccess("reports", "view")
  async aging(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(AgingReportQuerySchema))
    query: AgingReportQueryDto,
  ) {
    const data = await this.reports.aging(companyId, query);
    return { data };
  }

  @Get("profit-loss")
  @RequireAccess("reports", "view")
  async profitLoss(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ProfitLossReportQuerySchema))
    query: ProfitLossReportQueryDto,
  ) {
    const data = await this.reports.profitLoss(companyId, query);
    return { data };
  }

  @Get("hourly-sales")
  @RequireAccess("reports", "view")
  async hourlySales(
    @CurrentCompany() companyId: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
    @Query("branchId") branchId?: string,
  ) {
    const data = await this.reports.hourlySales(
      companyId,
      dateFrom,
      dateTo,
      branchId,
    );
    return { data };
  }

  @Get("category-sales")
  @RequireAccess("reports", "view")
  async categorySales(
    @CurrentCompany() companyId: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
    @Query("branchId") branchId?: string,
  ) {
    const data = await this.reports.categorySales(
      companyId,
      dateFrom,
      dateTo,
      branchId,
    );
    return { data };
  }

  @Get("supplier-sales")
  @RequireAccess("reports", "view")
  async supplierSales(
    @CurrentCompany() companyId: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
    @Query("branchId") branchId?: string,
  ) {
    const data = await this.reports.supplierSales(
      companyId,
      dateFrom,
      dateTo,
      branchId,
    );
    return { data };
  }

  @Get("overview")
  @RequireAccess("reports", "view")
  async overview(
    @CurrentCompany() companyId: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
    @Query("branchId") branchId?: string,
  ) {
    const data = await this.reports.overview(
      companyId,
      dateFrom,
      dateTo,
      branchId,
    );
    return { data };
  }

  @Get("cashier-sales")
  @RequireAccess("reports", "view")
  async cashierSales(
    @CurrentCompany() companyId: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
    @Query("branchId") branchId?: string,
  ) {
    const data = await this.reports.cashierSales(
      companyId,
      dateFrom,
      dateTo,
      branchId,
    );
    return { data };
  }
}
