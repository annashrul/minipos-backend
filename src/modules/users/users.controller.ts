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
  CreateUserSchema,
  ListUsersQuerySchema,
  UpdateUserSchema,
  type CreateUserDto,
  type ListUsersQueryDto,
  type UpdateUserDto,
} from "./dto/users.dto";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { UsersService } from "./users.service";

@Controller("users")
@UseGuards(AccessGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequireAccess("users", "view")
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListUsersQuerySchema)) query: ListUsersQueryDto,
  ) {
    const data = await this.users.list(companyId, query);
    return { data };
  }

  @Get("summary")
  @RequireAccess("users", "view")
  async summary(
    @CurrentCompany() companyId: string,
    @Query("branchId") branchId?: string,
  ) {
    const data = await this.users.summary(companyId, branchId || undefined);
    return { data };
  }

  @Get(":id")
  @RequireAccess("users", "view")
  async findOne(@CurrentCompany() companyId: string, @Param("id") id: string) {
    const data = await this.users.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("users", "create")
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateUserSchema)) body: CreateUserDto,
  ) {
    const data = await this.users.create(companyId, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("users", "update")
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
  async delete(@CurrentCompany() companyId: string, @Param("id") id: string) {
    const data = await this.users.delete(companyId, id);
    return { data };
  }
}
