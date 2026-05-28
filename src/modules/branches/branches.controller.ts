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
  CreateBranchSchema,
  ListBranchesQuerySchema,
  UpdateBranchSchema,
  type CreateBranchDto,
  type ListBranchesQueryDto,
  type UpdateBranchDto,
} from "./dto/branches.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { BranchesService } from "./branches.service";

@ApiTags("Branches")
@ApiBearerAuth()
@Controller("branches")
@UseGuards(AccessGuard)
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @RequireAccess("branches", "view")
  @ApiOperation({ summary: "List branches" })
  @ApiZodQuery(ListBranchesQuerySchema)
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
  @ApiOperation({ summary: "Branch summary" })
  async summary(@CurrentCompany() companyId: string) {
    const data = await this.branches.summary(companyId);
    return { data };
  }

  @Get(":id")
  @RequireAccess("branches", "view")
  @ApiOperation({ summary: "Get branch by ID" })
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.branches.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("branches", "create")
  @ApiOperation({ summary: "Create branch" })
  @ApiZodBody(CreateBranchSchema)
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateBranchSchema)) body: CreateBranchDto,
  ) {
    const data = await this.branches.create(companyId, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("branches", "update")
  @ApiOperation({ summary: "Update branch" })
  @ApiZodBody(UpdateBranchSchema)
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
  @ApiOperation({ summary: "Delete branch" })
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.branches.delete(companyId, id);
    return { data };
  }
}
