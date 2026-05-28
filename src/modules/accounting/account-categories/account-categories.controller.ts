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
  CreateAccountCategorySchema,
  ListAccountCategoriesQuerySchema,
  UpdateAccountCategorySchema,
  type CreateAccountCategoryDto,
  type ListAccountCategoriesQueryDto,
  type UpdateAccountCategoryDto,
} from "../dto/accounting.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { AccountCategoriesService } from "./account-categories.service";

@ApiTags("Account Categories")
@ApiBearerAuth()
@Controller("account-categories")
@UseGuards(AccessGuard)
export class AccountCategoriesController {
  constructor(
    private readonly categories: AccountCategoriesService,
  ) {}

  @Post("seed-default-coa")
  @RequireAccess("accounting", "create")
  @ApiOperation({ summary: "Seed default chart of accounts" })
  async seedDefaultCoa(@CurrentCompany() companyId: string) {
    const data = await this.categories.seedDefaultCoa(companyId);
    return { data };
  }

  @Post("backfill-journals")
  @RequireAccess("accounting", "create")
  @ApiOperation({ summary: "Backfill journals from historical transactions" })
  async backfillJournals(@CurrentCompany() companyId: string) {
    const data = await this.categories.backfillJournals(companyId);
    return { data };
  }

  @Get()
  @RequireAccess("accounting", "view")
  @ApiOperation({ summary: "List account categories" })
  @ApiZodQuery(ListAccountCategoriesQuerySchema)
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListAccountCategoriesQuerySchema))
    query: ListAccountCategoriesQueryDto,
  ) {
    const data = await this.categories.list(companyId, query);
    return { data };
  }

  @Get(":id")
  @RequireAccess("accounting", "view")
  @ApiOperation({ summary: "Get account category by ID" })
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.categories.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("accounting", "create")
  @ApiOperation({ summary: "Create account category" })
  @ApiZodBody(CreateAccountCategorySchema)
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateAccountCategorySchema))
    body: CreateAccountCategoryDto,
  ) {
    const data = await this.categories.create(companyId, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("accounting", "update")
  @ApiOperation({ summary: "Update account category" })
  @ApiZodBody(UpdateAccountCategorySchema)
  async update(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateAccountCategorySchema))
    body: UpdateAccountCategoryDto,
  ) {
    const data = await this.categories.update(companyId, id, body);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("accounting", "delete")
  @ApiOperation({ summary: "Delete account category" })
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.categories.delete(companyId, id);
    return { data };
  }
}
