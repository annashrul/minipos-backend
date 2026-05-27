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
  CreateAccountSchema,
  ListAccountsQuerySchema,
  UpdateAccountSchema,
  type CreateAccountDto,
  type ListAccountsQueryDto,
  type UpdateAccountDto,
} from "../dto/accounting.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { AccountsService } from "./accounts.service";

@Controller("accounts")
@UseGuards(AccessGuard)
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  @RequireAccess("accounting", "view")
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
  async tree(@CurrentCompany() companyId: string) {
    const data = await this.accounts.tree(companyId);
    return { data };
  }

  @Get("tree-with-balance")
  @RequireAccess("accounting", "view")
  async treeWithBalance(@CurrentCompany() companyId: string) {
    const data = await this.accounts.treeWithBalance(companyId);
    return { data };
  }

  @Get("coa-stats")
  @RequireAccess("accounting", "view")
  async coaStats(@CurrentCompany() companyId: string) {
    const data = await this.accounts.coaStats(companyId);
    return { data };
  }

  @Get(":id")
  @RequireAccess("accounting", "view")
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.accounts.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("accounting", "create")
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateAccountSchema)) body: CreateAccountDto,
  ) {
    const data = await this.accounts.create(companyId, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("accounting", "update")
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
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.accounts.delete(companyId, id);
    return { data };
  }
}
