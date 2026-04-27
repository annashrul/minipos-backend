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
  CreateAccountCategorySchema,
  ListAccountCategoriesQuerySchema,
  UpdateAccountCategorySchema,
  type CreateAccountCategoryDto,
  type ListAccountCategoriesQueryDto,
  type UpdateAccountCategoryDto,
} from "@/contracts";
import { ZodValidationPipe } from "../../../common/pipes/zod.pipe";
import { AccessGuard } from "../../auth/access.guard";
import { CurrentCompany } from "../../auth/current-company.decorator";
import { RequireAccess } from "../../auth/require-access.decorator";
import { AccountCategoriesService } from "./account-categories.service";

@Controller("account-categories")
@UseGuards(AccessGuard)
export class AccountCategoriesController {
  constructor(
    private readonly categories: AccountCategoriesService,
  ) {}

  @Post("seed-default-coa")
  @RequireAccess("accounting", "create")
  async seedDefaultCoa(@CurrentCompany() companyId: string) {
    const data = await this.categories.seedDefaultCoa(companyId);
    return { data };
  }

  @Post("backfill-journals")
  @RequireAccess("accounting", "create")
  async backfillJournals(@CurrentCompany() companyId: string) {
    const data = await this.categories.backfillJournals(companyId);
    return { data };
  }

  @Get()
  @RequireAccess("accounting", "view")
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
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.categories.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("accounting", "create")
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
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.categories.delete(companyId, id);
    return { data };
  }
}
