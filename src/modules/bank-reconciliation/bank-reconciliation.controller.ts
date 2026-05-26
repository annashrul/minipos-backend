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
  CreateBankReconciliationSchema,
  ListBankReconciliationsQuerySchema,
  SetReconciliationItemsSchema,
  ToggleItemMatchSchema,
  UpdateBankReconciliationSchema,
  type CreateBankReconciliationDto,
  type ListBankReconciliationsQueryDto,
  type SetReconciliationItemsDto,
  type ToggleItemMatchDto,
  type UpdateBankReconciliationDto,
} from "./dto/bank-reconciliation.dto";
import type { AuthUser } from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { BankReconciliationService } from "./bank-reconciliation.service";

@Controller("bank-reconciliation")
@UseGuards(AccessGuard)
export class BankReconciliationController {
  constructor(private readonly service: BankReconciliationService) {}

  @Get()
  @RequireAccess("bank-reconciliation", "view")
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListBankReconciliationsQuerySchema))
    query: ListBankReconciliationsQueryDto,
  ) {
    const data = await this.service.list(companyId, query);
    return { data };
  }

  @Get(":id")
  @RequireAccess("bank-reconciliation", "view")
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.service.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("bank-reconciliation", "create")
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateBankReconciliationSchema))
    body: CreateBankReconciliationDto,
  ) {
    const data = await this.service.create(companyId, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("bank-reconciliation", "update")
  async update(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateBankReconciliationSchema))
    body: UpdateBankReconciliationDto,
  ) {
    const data = await this.service.update(companyId, id, body);
    return { data };
  }

  @Post(":id/items")
  @RequireAccess("bank-reconciliation", "update")
  async setItems(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(SetReconciliationItemsSchema))
    body: SetReconciliationItemsDto,
  ) {
    const data = await this.service.setItems(companyId, id, body);
    return { data };
  }

  @Patch(":id/items/:itemId/match")
  @RequireAccess("bank-reconciliation", "update")
  async toggleMatch(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Param("itemId") itemId: string,
    @Body(new ZodValidationPipe(ToggleItemMatchSchema))
    body: ToggleItemMatchDto,
  ) {
    const data = await this.service.toggleItemMatch(
      companyId,
      id,
      itemId,
      body,
    );
    return { data };
  }

  @Post(":id/reconcile")
  @RequireAccess("bank-reconciliation", "reconcile")
  async reconcile(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
  ) {
    const data = await this.service.reconcile(companyId, user.id, id);
    return { data };
  }

  @Post(":id/reopen")
  @RequireAccess("bank-reconciliation", "reopen")
  async reopen(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.service.reopen(companyId, id);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("bank-reconciliation", "delete")
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.service.delete(companyId, id);
    return { data };
  }
}
