import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { type AuthUser } from "@/contracts";
import {
  CreateDebtSchema,
  ListDebtsQuerySchema,
  PayDebtSchema,
  type CreateDebtDto,
  type ListDebtsQueryDto,
  type PayDebtDto,
} from "./dto/debts.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { CurrentUser } from "@/modules/auth/current-user.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { DebtsService } from "./debts.service";

@Controller("debts")
@UseGuards(AccessGuard)
export class DebtsController {
  constructor(private readonly debts: DebtsService) {}

  @Get()
  @RequireAccess("debts", "view")
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListDebtsQuerySchema))
    query: ListDebtsQueryDto,
  ) {
    const data = await this.debts.list(companyId, query);
    return { data };
  }

  @Get("summary")
  @RequireAccess("debts", "view")
  async summary(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListDebtsQuerySchema))
    query: ListDebtsQueryDto,
  ) {
    const data = await this.debts.summary(companyId, query);
    return { data };
  }

  @Get(":id")
  @RequireAccess("debts", "view")
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.debts.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("debts", "create")
  async create(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateDebtSchema)) body: CreateDebtDto,
  ) {
    const data = await this.debts.create(companyId, user.id, body);
    return { data };
  }

  @Post(":id/pay")
  @RequireAccess("debts", "update")
  async pay(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(PayDebtSchema)) body: PayDebtDto,
  ) {
    const data = await this.debts.pay(companyId, user.id, id, body);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("debts", "delete")
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.debts.delete(companyId, id);
    return { data };
  }
}
