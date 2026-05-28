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
  CreateAccountSchema,
  ListAccountsQuerySchema,
  UpdateAccountSchema,
  type CreateAccountDto,
  type ListAccountsQueryDto,
  type UpdateAccountDto,
} from "../dto/accounting.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { AccountsService } from "./accounts.service";

@ApiTags("Accounts")
@ApiBearerAuth()
@Controller("accounts")
@UseGuards(AccessGuard)
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @RequireAccess("accounting", "view")
  @ApiOperation({ summary: "List accounts" })
  @ApiZodQuery(ListAccountsQuerySchema)
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListAccountsQuerySchema))
    query: ListAccountsQueryDto,
  ) {
    const data = await this.accounts.list(companyId, query);
    return { data };
  }

  @Get("tree")
  @RequireAccess("accounting", "view")
  @ApiOperation({ summary: "Get chart of accounts tree" })
  async tree(@CurrentCompany() companyId: string) {
    const data = await this.accounts.tree(companyId);
    return { data };
  }

  @Get("tree-with-balance")
  @RequireAccess("accounting", "view")
  @ApiOperation({ summary: "Get chart of accounts tree with balances" })
  async treeWithBalance(@CurrentCompany() companyId: string) {
    const data = await this.accounts.treeWithBalance(companyId);
    return { data };
  }

  @Get("coa-stats")
  @RequireAccess("accounting", "view")
  @ApiOperation({ summary: "Chart of accounts statistics" })
  async coaStats(@CurrentCompany() companyId: string) {
    const data = await this.accounts.coaStats(companyId);
    return { data };
  }

  @Get(":id")
  @RequireAccess("accounting", "view")
  @ApiOperation({ summary: "Get account by ID" })
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.accounts.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("accounting", "create")
  @ApiOperation({ summary: "Create account" })
  @ApiZodBody(CreateAccountSchema)
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateAccountSchema)) body: CreateAccountDto,
  ) {
    const data = await this.accounts.create(companyId, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("accounting", "update")
  @ApiOperation({ summary: "Update account" })
  @ApiZodBody(UpdateAccountSchema)
  async update(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateAccountSchema)) body: UpdateAccountDto,
  ) {
    const data = await this.accounts.update(companyId, id, body);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("accounting", "delete")
  @ApiOperation({ summary: "Delete account" })
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.accounts.delete(companyId, id);
    return { data };
  }
}
