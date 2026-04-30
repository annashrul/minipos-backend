import { Injectable } from "@nestjs/common";
import type {
  AgingReportQueryDto,
  AgingReportResponse,
  CustomerReportQueryDto,
  CustomerReportResponse,
  PaymentMethodReportQueryDto,
  PaymentMethodReportResponse,
  ProductReportQueryDto,
  ProductReportResponse,
  ProfitLossReportQueryDto,
  ProfitLossReportResponse,
  SalesReportQueryDto,
  SalesReportResponse,
} from "@/contracts";
import { AgingPLReportService } from "./internal/aging-pl.service";
import { CoreReportsService } from "./internal/core-reports.service";
import { ViewReportsService } from "./internal/view-reports.service";

/**
 * Facade tipis. Delegasi:
 *  - CoreReportsService    → sales / products / customers / paymentMethods
 *  - AgingPLReportService  → aging / profitLoss
 *  - ViewReportsService    → hourlySales / categorySales / supplierSales / overview / cashierSales
 *                            (semua pakai sales-view raw query via buildSalesViewWhere)
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly core: CoreReportsService,
    private readonly agingPL: AgingPLReportService,
    private readonly view: ViewReportsService,
  ) {}

  sales(
    companyId: string,
    query: SalesReportQueryDto,
  ): Promise<SalesReportResponse> {
    return this.core.sales(companyId, query);
  }
  products(
    companyId: string,
    query: ProductReportQueryDto,
  ): Promise<ProductReportResponse> {
    return this.core.products(companyId, query);
  }
  customers(
    companyId: string,
    query: CustomerReportQueryDto,
  ): Promise<CustomerReportResponse> {
    return this.core.customers(companyId, query);
  }
  paymentMethods(
    companyId: string,
    query: PaymentMethodReportQueryDto,
  ): Promise<PaymentMethodReportResponse> {
    return this.core.paymentMethods(companyId, query);
  }

  aging(
    companyId: string,
    query: AgingReportQueryDto,
  ): Promise<AgingReportResponse> {
    return this.agingPL.aging(companyId, query);
  }
  profitLoss(
    companyId: string,
    query: ProfitLossReportQueryDto,
  ): Promise<ProfitLossReportResponse> {
    return this.agingPL.profitLoss(companyId, query);
  }

  hourlySales(
    companyId: string,
    dateFrom?: string,
    dateTo?: string,
    branchId?: string,
  ) {
    return this.view.hourlySales(companyId, dateFrom, dateTo, branchId);
  }
  categorySales(
    companyId: string,
    dateFrom?: string,
    dateTo?: string,
    branchId?: string,
  ) {
    return this.view.categorySales(companyId, dateFrom, dateTo, branchId);
  }
  supplierSales(
    companyId: string,
    dateFrom?: string,
    dateTo?: string,
    branchId?: string,
  ) {
    return this.view.supplierSales(companyId, dateFrom, dateTo, branchId);
  }
  overview(
    companyId: string,
    dateFrom?: string,
    dateTo?: string,
    branchId?: string,
  ) {
    return this.view.overview(companyId, dateFrom, dateTo, branchId);
  }
  cashierSales(
    companyId: string,
    dateFrom?: string,
    dateTo?: string,
    branchId?: string,
  ) {
    return this.view.cashierSales(companyId, dateFrom, dateTo, branchId);
  }
}
