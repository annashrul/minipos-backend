import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import {
  AdjustStockSchema,
  ListBranchStockQuerySchema,
  ListStockMovementsQuerySchema,
  StockCardQuerySchema,
  type AdjustStockDto,
  type ListBranchStockQueryDto,
  type ListStockMovementsQueryDto,
  type StockCardQueryDto,
} from "./dto/stock.dto";
import type { AuthUser } from "@/contracts";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { CurrentUser } from "@/modules/auth/current-user.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { StockService } from "./stock.service";

@ApiTags("Stock")
@ApiBearerAuth()
@Controller("stock")
@UseGuards(AccessGuard)
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get("movements")
  @RequireAccess("stock", "view")
  @ApiOperation({ summary: "List stock movements" })
  @ApiZodQuery(ListStockMovementsQuerySchema)
  async listMovements(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListStockMovementsQuerySchema))
    query: ListStockMovementsQueryDto,
  ) {
    const data = await this.stock.listMovements(companyId, query);
    return { data };
  }

  @Get("movements/summary")
  @RequireAccess("stock", "view")
  @ApiOperation({ summary: "Stock movements summary" })
  async movementSummary(
    @CurrentCompany() companyId: string,
    @Query("branchId") branchId?: string,
  ) {
    const data = await this.stock.movementSummary(companyId, branchId);
    return { data };
  }

  @Get("branch")
  @RequireAccess("stock", "view")
  @ApiOperation({ summary: "List stock by branch" })
  @ApiZodQuery(ListBranchStockQuerySchema)
  async listBranchStock(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListBranchStockQuerySchema))
    query: ListBranchStockQueryDto,
  ) {
    const data = await this.stock.listBranchStock(companyId, query);
    return { data };
  }

  @Post("adjust")
  @RequireAccess("stock", "update")
  @ApiOperation({ summary: "Adjust stock" })
  @ApiZodBody(AdjustStockSchema)
  async adjust(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(AdjustStockSchema)) body: AdjustStockDto,
  ) {
    const data = await this.stock.adjust(companyId, user.id, body);
    return { data };
  }

  @Get("by-product/:productId")
  @RequireAccess("stock", "view")
  @ApiOperation({ summary: "Get stock by product" })
  async byProduct(
    @CurrentCompany() companyId: string,
    @Param("productId") productId: string,
  ) {
    const data = await this.stock.byProduct(companyId, productId);
    return { data };
  }

  @Get("card")
  @RequireAccess("stock", "view")
  @ApiOperation({ summary: "Get stock card" })
  @ApiZodQuery(StockCardQuerySchema)
  async stockCard(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(StockCardQuerySchema)) query: StockCardQueryDto,
  ) {
    const data = await this.stock.stockCard(companyId, query);
    return { data };
  }
}
