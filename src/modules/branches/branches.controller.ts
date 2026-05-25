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
  CreateBranchSchema,
  ListBranchesQuerySchema,
  UpdateBranchSchema,
  type CreateBranchDto,
  type ListBranchesQueryDto,
  type UpdateBranchDto,
} from "./dto/branches.dto";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { BranchesService } from "./branches.service";

@Controller("branches")
@UseGuards(AccessGuard)
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @RequireAccess("branches", "view")
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListBranchesQuerySchema))
    query: ListBranchesQueryDto,
  ) {
    const data = await this.branches.list(companyId, query);
    return { data };
  }

  @Get("summary")
  @RequireAccess("branches", "view")
  async summary(@CurrentCompany() companyId: string) {
    const data = await this.branches.summary(companyId);
    return { data };
  }

  @Get(":id")
  @RequireAccess("branches", "view")
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.branches.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("branches", "create")
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateBranchSchema)) body: CreateBranchDto,
  ) {
    const data = await this.branches.create(companyId, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("branches", "update")
  async update(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateBranchSchema)) body: UpdateBranchDto,
  ) {
    const data = await this.branches.update(companyId, id, body);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("branches", "delete")
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.branches.delete(companyId, id);
    return { data };
  }
}
