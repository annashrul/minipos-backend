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
import {
  CreateStockTransferSchema,
  ListStockTransfersQuerySchema,
  ReceiveStockTransferSchema,
  type AuthUser,
  type CreateStockTransferDto,
  type ListStockTransfersQueryDto,
  type ReceiveStockTransferDto,
} from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { StockTransfersService } from "./stock-transfers.service";

@Controller("stock-transfers")
@UseGuards(AccessGuard)
export class StockTransfersController {
  constructor(private readonly transfers: StockTransfersService) {}

  @Get()
  @RequireAccess("stock-transfers", "view")
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
  async summary(
    @CurrentCompany() companyId: string,
    @Query("branchId") branchId?: string,
  ) {
    const data = await this.transfers.summary(companyId, branchId);
    return { data };
  }

  @Get(":id")
  @RequireAccess("stock-transfers", "view")
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.transfers.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("stock-transfers", "create")
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
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.transfers.delete(companyId, id);
    return { data };
  }
}
