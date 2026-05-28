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
import { type AuthUser } from "@/contracts";
import {
  CreateExpenseSchema,
  ListExpensesQuerySchema,
  UpdateExpenseSchema,
  type CreateExpenseDto,
  type ListExpensesQueryDto,
  type UpdateExpenseDto,
} from "./dto/expenses.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { CurrentUser } from "@/modules/auth/current-user.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { ExpensesService } from "./expenses.service";

@ApiTags("Expenses")
@ApiBearerAuth()
@Controller("expenses")
@UseGuards(AccessGuard)
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Get()
  @RequireAccess("expenses", "view")
  @ApiOperation({ summary: "List expenses" })
  @ApiZodQuery(ListExpensesQuerySchema)
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
  @ApiOperation({ summary: "Expenses summary" })
  @ApiZodQuery(ListExpensesQuerySchema)
  async summary(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListExpensesQuerySchema))
    query: ListExpensesQueryDto,
  ) {
    const data = await this.expenses.summary(companyId, query);
    return { data };
  }

  @Get("stats")
  @RequireAccess("expenses", "view")
  @ApiOperation({ summary: "Expenses stats" })
  async stats(
    @CurrentCompany() companyId: string,
    @Query("branchId") branchId?: string,
  ) {
    const data = await this.expenses.stats(companyId, branchId);
    return { data };
  }

  @Get(":id")
  @RequireAccess("expenses", "view")
  @ApiOperation({ summary: "Get expense by ID" })
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.expenses.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("expenses", "create")
  @ApiOperation({ summary: "Create expense" })
  @ApiZodBody(CreateExpenseSchema)
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
  @ApiOperation({ summary: "Update expense" })
  @ApiZodBody(UpdateExpenseSchema)
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
  @ApiOperation({ summary: "Delete expense" })
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.expenses.delete(companyId, id);
    return { data };
  }
}
