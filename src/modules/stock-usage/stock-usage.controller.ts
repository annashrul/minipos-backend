import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { type AuthUser } from "@/contracts";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentUser } from "@/modules/auth/current-user.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { StockUsageService } from "./stock-usage.service";
import {
  CreateStockUsageSchema,
  type CreateStockUsageDto,
  ListStockUsageQuerySchema,
  type ListStockUsageQueryDto,
} from "./dto/stock-usage.dto";

@ApiTags("Pemakaian Barang")
@ApiBearerAuth()
@Controller("stock-usage")
@UseGuards(AccessGuard)
export class StockUsageController {
  constructor(private readonly service: StockUsageService) {}

  @Get()
  @RequireAccess("stock-usage", "view")
  @ApiOperation({ summary: "Daftar dokumen pemakaian barang" })
  async list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListStockUsageQuerySchema))
    query: ListStockUsageQueryDto,
  ) {
    const data = await this.service.list(user.companyId ?? "", query);
    return { data };
  }

  @Get(":id")
  @RequireAccess("stock-usage", "view")
  @ApiOperation({ summary: "Detail dokumen pemakaian barang" })
  async findOne(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    const data = await this.service.findOne(user.companyId ?? "", id);
    return { data };
  }

  @Post()
  @RequireAccess("stock-usage", "create")
  @ApiOperation({ summary: "Catat pemakaian barang (potong stok)" })
  @ApiZodBody(CreateStockUsageSchema)
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateStockUsageSchema))
    body: CreateStockUsageDto,
  ) {
    const data = await this.service.create(user.companyId ?? "", user.id, body);
    return { data };
  }
}
