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
  CreateStoreCreditSchema,
  ListStoreCreditsQuerySchema,
  UpdateStoreCreditSchema,
  UseStoreCreditSchema,
  type AuthUser,
  type CreateStoreCreditDto,
  type ListStoreCreditsQueryDto,
  type UpdateStoreCreditDto,
  type UseStoreCreditDto,
} from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { StoreCreditsService } from "./store-credits.service";

@Controller("store-credits")
@UseGuards(AccessGuard)
export class StoreCreditsController {
  constructor(private readonly storeCredits: StoreCreditsService) {}

  @Get()
  @RequireAccess("store-credits", "view")
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListStoreCreditsQuerySchema))
    query: ListStoreCreditsQueryDto,
  ) {
    const data = await this.storeCredits.list(companyId, query);
    return { data };
  }

  @Get("customer/:customerId/total")
  @RequireAccess("store-credits", "view")
  async customerTotal(
    @CurrentCompany() companyId: string,
    @Param("customerId") customerId: string,
  ) {
    const data = await this.storeCredits.customerTotal(companyId, customerId);
    return { data };
  }

  @Get(":id")
  @RequireAccess("store-credits", "view")
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.storeCredits.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("store-credits", "create")
  async create(
    @CurrentCompany() companyId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateStoreCreditSchema))
    body: CreateStoreCreditDto,
  ) {
    const data = await this.storeCredits.create(companyId, user.id, body);
    return { data };
  }

  @Post(":id/use")
  @RequireAccess("store-credits", "use")
  async use(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UseStoreCreditSchema))
    body: UseStoreCreditDto,
  ) {
    const data = await this.storeCredits.use(companyId, id, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("store-credits", "update")
  async update(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateStoreCreditSchema))
    body: UpdateStoreCreditDto,
  ) {
    const data = await this.storeCredits.update(companyId, id, body);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("store-credits", "delete")
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.storeCredits.delete(companyId, id);
    return { data };
  }
}
