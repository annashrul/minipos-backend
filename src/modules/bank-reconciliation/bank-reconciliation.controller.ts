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
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { CurrentUser } from "@/modules/auth/current-user.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { BankReconciliationService } from "./bank-reconciliation.service";

@ApiTags("Bank Reconciliation")
@ApiBearerAuth()
@Controller("bank-reconciliation")
@UseGuards(AccessGuard)
export class BankReconciliationController {
  constructor(private readonly service: BankReconciliationService) {}

  @Get()
  @RequireAccess("bank-reconciliation", "view")
  @ApiOperation({ summary: "List bank reconciliations" })
  @ApiZodQuery(ListBankReconciliationsQuerySchema)
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
  @ApiOperation({ summary: "Get bank reconciliation by ID" })
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.service.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("bank-reconciliation", "create")
  @ApiOperation({ summary: "Create bank reconciliation" })
  @ApiZodBody(CreateBankReconciliationSchema)
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
  @ApiOperation({ summary: "Update bank reconciliation" })
  @ApiZodBody(UpdateBankReconciliationSchema)
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
  @ApiOperation({ summary: "Set reconciliation items" })
  @ApiZodBody(SetReconciliationItemsSchema)
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
  @ApiOperation({ summary: "Toggle reconciliation item match" })
  @ApiZodBody(ToggleItemMatchSchema)
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
  @ApiOperation({ summary: "Reconcile bank reconciliation" })
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
  @ApiOperation({ summary: "Reopen bank reconciliation" })
  async reopen(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.service.reopen(companyId, id);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("bank-reconciliation", "delete")
  @ApiOperation({ summary: "Delete bank reconciliation" })
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.service.delete(companyId, id);
    return { data };
  }
}
