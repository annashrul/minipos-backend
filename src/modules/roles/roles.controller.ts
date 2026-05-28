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
  CreateRoleSchema,
  ListRolesQuerySchema,
  ToggleRoleActionPermissionSchema,
  ToggleRoleMenuPermissionSchema,
  UpdateRoleSchema,
  type CreateRoleDto,
  type ListRolesQueryDto,
  type ToggleRoleActionPermissionDto,
  type ToggleRoleMenuPermissionDto,
  type UpdateRoleDto,
} from "./dto/roles.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { RolesService } from "./roles.service";

@ApiTags("Roles")
@ApiBearerAuth()
@Controller("roles")
@UseGuards(AccessGuard)
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequireAccess("roles", "view")
  @ApiOperation({ summary: "List roles" })
  @ApiZodQuery(ListRolesQuerySchema)
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListRolesQuerySchema))
    query: ListRolesQueryDto,
  ) {
    const data = await this.roles.list(companyId, query);
    return { data };
  }

  @Get("menus")
  @RequireAccess("roles", "view")
  @ApiOperation({ summary: "List menus for role assignment" })
  async menus() {
    const data = await this.roles.listMenus();
    return { data };
  }

  @Get(":id")
  @RequireAccess("roles", "view")
  @ApiOperation({ summary: "Get role by ID" })
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.roles.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("roles", "create")
  @ApiOperation({ summary: "Create role" })
  @ApiZodBody(CreateRoleSchema)
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreateRoleSchema)) body: CreateRoleDto,
  ) {
    const data = await this.roles.create(companyId, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("roles", "update")
  @ApiOperation({ summary: "Update role" })
  @ApiZodBody(UpdateRoleSchema)
  async update(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateRoleSchema)) body: UpdateRoleDto,
  ) {
    const data = await this.roles.update(companyId, id, body);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("roles", "delete")
  @ApiOperation({ summary: "Delete role" })
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.roles.delete(companyId, id);
    return { data };
  }

  @Patch("permissions/menu")
  @RequireAccess("access-control", "view")
  @ApiOperation({ summary: "Toggle role menu permission" })
  @ApiZodBody(ToggleRoleMenuPermissionSchema)
  async toggleMenuPermission(
    @Body(new ZodValidationPipe(ToggleRoleMenuPermissionSchema))
    body: ToggleRoleMenuPermissionDto,
  ) {
    const data = await this.roles.setMenuPermission(body);
    return { data };
  }

  @Patch("permissions/action")
  @RequireAccess("access-control", "view")
  @ApiOperation({ summary: "Toggle role action permission" })
  @ApiZodBody(ToggleRoleActionPermissionSchema)
  async toggleActionPermission(
    @Body(new ZodValidationPipe(ToggleRoleActionPermissionSchema))
    body: ToggleRoleActionPermissionDto,
  ) {
    const data = await this.roles.setActionPermission(body);
    return { data };
  }
}
