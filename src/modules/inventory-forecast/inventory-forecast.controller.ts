import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
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
import { ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { InventoryForecastService } from "./inventory-forecast.service";

@ApiTags("Inventory Forecast")
@ApiBearerAuth()
@Controller("inventory-forecast")
@UseGuards(AccessGuard)
export class InventoryForecastController {
  constructor(private readonly service: InventoryForecastService) {}

  @Get("products")
  @RequireAccess("inventory-forecast", "view")
  @ApiOperation({ summary: "Get inventory forecast for products" })
  @ApiZodQuery(InventoryForecastQuerySchema)
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
  @ApiOperation({ summary: "Get forecast summary" })
  @ApiZodQuery(ForecastSummaryQuerySchema)
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
  @ApiOperation({ summary: "Get product sales trend" })
  @ApiZodQuery(ProductSalesTrendQuerySchema)
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
  @ApiOperation({ summary: "Generate auto reorder suggestions" })
  @ApiZodQuery(AutoReorderQuerySchema)
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
  @ApiOperation({ summary: "List products at stockout risk" })
  @ApiZodQuery(InventoryForecastQuerySchema)
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
