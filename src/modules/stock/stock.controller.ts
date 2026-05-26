import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
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
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { StockService } from "./stock.service";

@Controller("stock")
@UseGuards(AccessGuard)
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get("movements")
  @RequireAccess("stock", "view")
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
  async movementSummary(
    @CurrentCompany() companyId: string,
    @Query("branchId") branchId?: string,
  ) {
    const data = await this.stock.movementSummary(companyId, branchId);
    return { data };
  }

  @Get("branch")
  @RequireAccess("stock", "view")
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
  async byProduct(
    @CurrentCompany() companyId: string,
    @Param("productId") productId: string,
  ) {
    const data = await this.stock.byProduct(companyId, productId);
    return { data };
  }

  @Get("card")
  @RequireAccess("stock", "view")
  async stockCard(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(StockCardQuerySchema)) query: StockCardQueryDto,
  ) {
    const data = await this.stock.stockCard(companyId, query);
    return { data };
  }
}
