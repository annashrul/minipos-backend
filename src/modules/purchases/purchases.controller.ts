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
  ClosePurchaseSchema,
  CreatePurchaseSchema,
  ListPurchasesQuerySchema,
  ReceivePurchaseSchema,
  UpdatePurchaseSchema,
  UpdatePurchaseStatusSchema,
  type AuthUser,
  type ClosePurchaseDto,
  type CreatePurchaseDto,
  type ListPurchasesQueryDto,
  type ReceivePurchaseDto,
  type UpdatePurchaseDto,
  type UpdatePurchaseStatusDto,
} from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { PurchasesService } from "./purchases.service";

@Controller("purchases")
@UseGuards(AccessGuard)
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get()
  @RequireAccess("purchases", "view")
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
  async summary(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListPurchasesQuerySchema))
    query: ListPurchasesQueryDto,
  ) {
    const data = await this.purchases.summary(companyId, query);
    return { data };
  }

  @Get(":id")
  @RequireAccess("purchases", "view")
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.purchases.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("purchases", "create")
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
  async updateStatus(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdatePurchaseStatusSchema))
    body: UpdatePurchaseStatusDto,
  ) {
    const data = await this.purchases.updateStatus(companyId, id, body);
    return { data };
  }

  @Post(":id/receive")
  @RequireAccess("purchases", "receive")
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
  async close(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(ClosePurchaseSchema)) body: ClosePurchaseDto,
  ) {
    const data = await this.purchases.close(companyId, id, body);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("purchases", "delete")
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.purchases.delete(companyId, id);
    return { data };
  }
}
