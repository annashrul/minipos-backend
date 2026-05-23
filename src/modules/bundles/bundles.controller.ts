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
  CreateBundleSchema,
  ListBundlesQuerySchema,
  UpdateBundleSchema,
  type CreateBundleDto,
  type ListBundlesQueryDto,
  type UpdateBundleDto,
} from "./dto/bundles.dto";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { BundlesService } from "./bundles.service";

@Controller("bundles")
@UseGuards(AccessGuard)
export class BundlesController {
  constructor(private readonly bundles: BundlesService) {}

  @Get()
  @RequireAccess("bundles", "view")
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListBundlesQuerySchema))
    query: ListBundlesQueryDto,
  ) {
    const data = await this.bundles.list(companyId, query);
    return { data };
  }

  @Get(":id")
  @RequireAccess("bundles", "view")
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.bundles.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("bundles", "create")
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateBundleSchema)) body: CreateBundleDto,
  ) {
    const data = await this.bundles.create(companyId, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("bundles", "update")
  async update(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateBundleSchema)) body: UpdateBundleDto,
  ) {
    const data = await this.bundles.update(companyId, id, body);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("bundles", "delete")
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.bundles.delete(companyId, id);
    return { data };
  }
}
