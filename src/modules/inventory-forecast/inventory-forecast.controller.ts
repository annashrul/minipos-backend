import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import {
  AutoReorderQuerySchema,
  ForecastSummaryQuerySchema,
  InventoryForecastQuerySchema,
  ProductSalesTrendQuerySchema,
  type AutoReorderQueryDto,
  type ForecastSummaryQueryDto,
  type InventoryForecastQueryDto,
  type ProductSalesTrendQueryDto,
} from "./dto/inventory-forecast.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { InventoryForecastService } from "./inventory-forecast.service";

@Controller("inventory-forecast")
@UseGuards(AccessGuard)
export class InventoryForecastController {
  constructor(private readonly service: InventoryForecastService) {}

  @Get("products")
  @RequireAccess("inventory-forecast", "view")
  async products(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(InventoryForecastQuerySchema))
    query: InventoryForecastQueryDto,
  ) {
    const data = await this.service.getForecast(companyId, query);
    return { data };
  }

  @Get("summary")
  @RequireAccess("inventory-forecast", "view")
  async summary(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ForecastSummaryQuerySchema))
    query: ForecastSummaryQueryDto,
  ) {
    const data = await this.service.getSummary(companyId, query);
    return { data };
  }

  @Get("sales-trend")
  @RequireAccess("inventory-forecast", "view")
  async salesTrend(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ProductSalesTrendQuerySchema))
    query: ProductSalesTrendQueryDto,
  ) {
    const data = await this.service.getProductSalesTrend(companyId, query);
    return { data };
  }

  @Get("reorder-suggestions")
  @RequireAccess("inventory-forecast", "view")
  async reorderSuggestions(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(AutoReorderQuerySchema))
    query: AutoReorderQueryDto,
  ) {
    const data = await this.service.generateAutoReorderList(companyId, query);
    return { data };
  }

  @Get("stockout-risk")
  @RequireAccess("inventory-forecast", "view")
  async stockoutRisk(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(InventoryForecastQuerySchema))
    query: InventoryForecastQueryDto,
  ) {
    const result = await this.service.getForecast(companyId, {
      ...query,
      riskLevel: undefined,
      page: undefined,
      perPage: undefined,
    });
    const data = result.items.filter(
      (p) => p.riskLevel === "CRITICAL" || p.riskLevel === "WARNING",
    );
    return { data };
  }
}
