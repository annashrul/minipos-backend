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
  CreateUserSchema,
  ListUsersQuerySchema,
  UpdateUserSchema,
  type CreateUserDto,
  type ListUsersQueryDto,
  type UpdateUserDto,
} from "./dto/users.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { UsersService } from "./users.service";

@ApiTags("Users")
@ApiBearerAuth()
@Controller("users")
@UseGuards(AccessGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequireAccess("users", "view")
  @ApiOperation({ summary: "List users" })
  @ApiZodQuery(ListUsersQuerySchema)
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListUsersQuerySchema)) query: ListUsersQueryDto,
  ) {
    const data = await this.users.list(companyId, query);
    return { data };
  }

  @Get("summary")
  @RequireAccess("users", "view")
  @ApiOperation({ summary: "User summary" })
  async summary(
    @CurrentCompany() companyId: string,
    @Query("branchId") branchId?: string,
  ) {
    const data = await this.users.summary(companyId, branchId || undefined);
    return { data };
  }

  @Get(":id")
  @RequireAccess("users", "view")
  @ApiOperation({ summary: "Get user by ID" })
  async findOne(@CurrentCompany() companyId: string, @Param("id") id: string) {
    const data = await this.users.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("users", "create")
  @ApiOperation({ summary: "Create user" })
  @ApiZodBody(CreateUserSchema)
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateUserSchema)) body: CreateUserDto,
  ) {
    const data = await this.users.create(companyId, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("users", "update")
  @ApiOperation({ summary: "Update user" })
  @ApiZodBody(UpdateUserSchema)
  async update(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateUserSchema)) body: UpdateUserDto,
  ) {
    const data = await this.users.update(companyId, id, body);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("users", "delete")
  @ApiOperation({ summary: "Delete user" })
  async delete(@CurrentCompany() companyId: string, @Param("id") id: string) {
    const data = await this.users.delete(companyId, id);
    return { data };
  }
}
