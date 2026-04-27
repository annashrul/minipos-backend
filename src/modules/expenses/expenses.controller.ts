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
  CreateExpenseSchema,
  ListExpensesQuerySchema,
  UpdateExpenseSchema,
  type AuthUser,
  type CreateExpenseDto,
  type ListExpensesQueryDto,
  type UpdateExpenseDto,
} from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { ExpensesService } from "./expenses.service";

@Controller("expenses")
@UseGuards(AccessGuard)
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  @RequireAccess("expenses", "view")
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListExpensesQuerySchema))
    query: ListExpensesQueryDto,
  ) {
    const data = await this.expenses.list(companyId, query);
    return { data };
  }

  @Get("summary")
  @RequireAccess("expenses", "view")
  async summary(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListExpensesQuerySchema))
    query: ListExpensesQueryDto,
  ) {
    const data = await this.expenses.summary(companyId, query);
    return { data };
  }

  @Get(":id")
  @RequireAccess("expenses", "view")
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.expenses.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("expenses", "create")
  async create(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateExpenseSchema)) body: CreateExpenseDto,
  ) {
    const data = await this.expenses.create(companyId, user.id, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("expenses", "update")
  async update(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateExpenseSchema)) body: UpdateExpenseDto,
  ) {
    const data = await this.expenses.update(companyId, id, body);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("expenses", "delete")
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.expenses.delete(companyId, id);
    return { data };
  }
}
