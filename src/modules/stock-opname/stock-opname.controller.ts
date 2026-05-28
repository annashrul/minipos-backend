import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import {
  CreateStockOpnameSchema,
  ListStockOpnameQuerySchema,
  SetOpnameItemsSchema,
  type CreateStockOpnameDto,
  type ListStockOpnameQueryDto,
  type SetOpnameItemsDto,
} from "./dto/stock-opname.dto";
import type { AuthUser } from "@/contracts";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { CurrentUser } from "@/modules/auth/current-user.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { StockOpnameService } from "./stock-opname.service";

@ApiTags("Stock Opname")
@ApiBearerAuth()
@Controller("stock-opname")
@UseGuards(AccessGuard)
export class StockOpnameController {
  constructor(private readonly opname: StockOpnameService) {}

  @Get()
  @RequireAccess("stock-opname", "view")
  @ApiOperation({ summary: "List stock opname" })
  @ApiZodQuery(ListStockOpnameQuerySchema)
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListStockOpnameQuerySchema))
    query: ListStockOpnameQueryDto,
  ) {
    const data = await this.opname.list(companyId, query);
    return { data };
  }

  @Get(":id")
  @RequireAccess("stock-opname", "view")
  @ApiOperation({ summary: "Get stock opname by ID" })
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.opname.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("stock-opname", "create")
  @ApiOperation({ summary: "Create stock opname" })
  @ApiZodBody(CreateStockOpnameSchema)
  async create(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateStockOpnameSchema))
    body: CreateStockOpnameDto,
  ) {
    const data = await this.opname.create(companyId, user.id, body);
    return { data };
  }

  @Post(":id/items")
  @RequireAccess("stock-opname", "update")
  @ApiOperation({ summary: "Set stock opname items" })
  @ApiZodBody(SetOpnameItemsSchema)
  async setItems(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(SetOpnameItemsSchema)) body: SetOpnameItemsDto,
  ) {
    const data = await this.opname.setItems(companyId, id, body);
    return { data };
  }

  @Patch(":id/start")
  @RequireAccess("stock-opname", "update")
  @ApiOperation({ summary: "Start stock opname" })
  async start(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.opname.start(companyId, id);
    return { data };
  }

  @Post(":id/complete")
  @RequireAccess("stock-opname", "complete")
  @ApiOperation({ summary: "Complete stock opname" })
  async complete(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
  ) {
    const data = await this.opname.complete(companyId, user.id, id);
    return { data };
  }

  @Patch(":id/cancel")
  @RequireAccess("stock-opname", "cancel")
  @ApiOperation({ summary: "Cancel stock opname" })
  async cancel(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.opname.cancel(companyId, id);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("stock-opname", "delete")
  @ApiOperation({ summary: "Delete stock opname" })
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.opname.delete(companyId, id);
    return { data };
  }
}
