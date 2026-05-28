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
  CreateStockTransferSchema,
  ListStockTransfersQuerySchema,
  ReceiveStockTransferSchema,
  type CreateStockTransferDto,
  type ListStockTransfersQueryDto,
  type ReceiveStockTransferDto,
} from "./dto/stock-transfers.dto";
import type { AuthUser } from "@/contracts";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { CurrentUser } from "@/modules/auth/current-user.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { StockTransfersService } from "./stock-transfers.service";

@ApiTags("Stock Transfers")
@ApiBearerAuth()
@Controller("stock-transfers")
@UseGuards(AccessGuard)
export class StockTransfersController {
  constructor(private readonly transfers: StockTransfersService) {}

  @Get()
  @RequireAccess("stock-transfers", "view")
  @ApiOperation({ summary: "List stock transfers" })
  @ApiZodQuery(ListStockTransfersQuerySchema)
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListStockTransfersQuerySchema))
    query: ListStockTransfersQueryDto,
  ) {
    const data = await this.transfers.list(companyId, query);
    return { data };
  }

  @Get("summary")
  @RequireAccess("stock-transfers", "view")
  @ApiOperation({ summary: "Stock transfers summary" })
  async summary(
    @CurrentCompany() companyId: string,
    @Query("branchId") branchId?: string,
  ) {
    const data = await this.transfers.summary(companyId, branchId);
    return { data };
  }

  @Get(":id")
  @RequireAccess("stock-transfers", "view")
  @ApiOperation({ summary: "Get stock transfer by ID" })
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.transfers.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("stock-transfers", "create")
  @ApiOperation({ summary: "Create stock transfer" })
  @ApiZodBody(CreateStockTransferSchema)
  async create(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateStockTransferSchema))
    body: CreateStockTransferDto,
  ) {
    const data = await this.transfers.create(companyId, user.id, body);
    return { data };
  }

  @Post(":id/send")
  @RequireAccess("stock-transfers", "send")
  @ApiOperation({ summary: "Send stock transfer" })
  async send(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
  ) {
    const data = await this.transfers.send(companyId, user.id, id);
    return { data };
  }

  @Post(":id/receive")
  @RequireAccess("stock-transfers", "receive")
  @ApiOperation({ summary: "Receive stock transfer" })
  @ApiZodBody(ReceiveStockTransferSchema)
  async receive(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(ReceiveStockTransferSchema))
    body: ReceiveStockTransferDto,
  ) {
    const data = await this.transfers.receive(companyId, user.id, id, body);
    return { data };
  }

  @Patch(":id/cancel")
  @RequireAccess("stock-transfers", "cancel")
  @ApiOperation({ summary: "Cancel stock transfer" })
  async cancel(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
  ) {
    const data = await this.transfers.cancel(companyId, user.id, id);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("stock-transfers", "delete")
  @ApiOperation({ summary: "Delete stock transfer" })
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.transfers.delete(companyId, id);
    return { data };
  }
}
