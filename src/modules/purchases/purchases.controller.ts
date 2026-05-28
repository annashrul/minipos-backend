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
  ClosePurchaseSchema,
  CreatePurchaseSchema,
  ListPurchaseTransactionLogQuerySchema,
  ListPurchasesQuerySchema,
  ReceivePurchaseSchema,
  UpdatePurchaseSchema,
  UpdatePurchaseStatusSchema,
  type ClosePurchaseDto,
  type CreatePurchaseDto,
  type ListPurchaseTransactionLogQueryDto,
  type ListPurchasesQueryDto,
  type ReceivePurchaseDto,
  type UpdatePurchaseDto,
  type UpdatePurchaseStatusDto,
} from "./dto/purchases.dto";
import type { AuthUser } from "@/contracts";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { CurrentUser } from "@/modules/auth/current-user.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { PurchasesService } from "./purchases.service";

@ApiTags("Purchases")
@ApiBearerAuth()
@Controller("purchases")
@UseGuards(AccessGuard)
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get()
  @RequireAccess("purchases", "view")
  @ApiOperation({ summary: "List purchases" })
  @ApiZodQuery(ListPurchasesQuerySchema)
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListPurchasesQuerySchema))
    query: ListPurchasesQueryDto,
  ) {
    const data = await this.purchases.list(companyId, query);
    return { data };
  }

  @Get("summary")
  @RequireAccess("purchases", "view")
  @ApiOperation({ summary: "Purchases summary" })
  @ApiZodQuery(ListPurchasesQuerySchema)
  async summary(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListPurchasesQuerySchema))
    query: ListPurchasesQueryDto,
  ) {
    const data = await this.purchases.summary(companyId, query);
    return { data };
  }

  // Laporan Pembelian — list semua row PurchaseTransactionLog (pergerakan
  // status PO + receiving + completion). Akses guard pakai purchase-report.
  @Get("transaction-log")
  @RequireAccess("purchase-report", "view")
  @ApiOperation({ summary: "List purchase transaction log" })
  @ApiZodQuery(ListPurchaseTransactionLogQuerySchema)
  async transactionLog(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListPurchaseTransactionLogQuerySchema))
    query: ListPurchaseTransactionLogQueryDto,
  ) {
    const data = await this.purchases.listTransactionLog(companyId, query);
    return { data };
  }

  @Get(":id")
  @RequireAccess("purchases", "view")
  @ApiOperation({ summary: "Get purchase by ID" })
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.purchases.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("purchases", "create")
  @ApiOperation({ summary: "Create purchase" })
  @ApiZodBody(CreatePurchaseSchema)
  async create(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreatePurchaseSchema)) body: CreatePurchaseDto,
  ) {
    const data = await this.purchases.create(companyId, user.id, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("purchases", "update")
  @ApiOperation({ summary: "Update purchase" })
  @ApiZodBody(UpdatePurchaseSchema)
  async update(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdatePurchaseSchema)) body: UpdatePurchaseDto,
  ) {
    const data = await this.purchases.update(companyId, id, body);
    return { data };
  }

  @Patch(":id/status")
  @RequireAccess("purchases", "update")
  @ApiOperation({ summary: "Update purchase status" })
  @ApiZodBody(UpdatePurchaseStatusSchema)
  async updateStatus(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdatePurchaseStatusSchema))
    body: UpdatePurchaseStatusDto,
  ) {
    const data = await this.purchases.updateStatus(
      companyId,
      user.id,
      id,
      body,
    );
    return { data };
  }

  @Post(":id/receive")
  @RequireAccess("purchases", "receive")
  @ApiOperation({ summary: "Receive purchase items" })
  @ApiZodBody(ReceivePurchaseSchema)
  async receive(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(ReceivePurchaseSchema)) body: ReceivePurchaseDto,
  ) {
    const data = await this.purchases.receive(companyId, user.id, id, body);
    return { data };
  }

  @Post(":id/close")
  @RequireAccess("purchases", "receive")
  @ApiOperation({ summary: "Close purchase" })
  @ApiZodBody(ClosePurchaseSchema)
  async close(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(ClosePurchaseSchema)) body: ClosePurchaseDto,
  ) {
    const data = await this.purchases.close(companyId, user.id, id, body);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("purchases", "delete")
  @ApiOperation({ summary: "Delete purchase" })
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.purchases.delete(companyId, id);
    return { data };
  }
}
