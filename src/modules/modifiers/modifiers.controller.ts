import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import {
  CreateModifierGroupSchema,
  ListModifierGroupsQuerySchema,
  UpdateModifierGroupSchema,
  AttachProductModifierSchema,
  type CreateModifierGroupDto,
  type ListModifierGroupsQueryDto,
  type UpdateModifierGroupDto,
  type AttachProductModifierDto,
} from "./dto/modifiers.dto";
import { ModifiersService } from "./modifiers.service";

@ApiTags("Modifiers")
@ApiBearerAuth()
@Controller("modifiers")
export class ModifiersController {
  constructor(private readonly service: ModifiersService) {}

  @Get()
  @ApiOperation({ summary: "List modifier groups" })
  async list(
    @CurrentCompany() companyId: string,
    @Query() query: Record<string, unknown>,
  ) {
    const parsed: ListModifierGroupsQueryDto =
      ListModifierGroupsQuerySchema.parse(query);
    const data = await this.service.list(companyId, parsed);
    return { data };
  }

  @Get("summary")
  @ApiOperation({ summary: "Modifier groups summary" })
  async summary(@CurrentCompany() companyId: string) {
    const data = await this.service.summary(companyId);
    return { data };
  }

  @Get(":id")
  @ApiOperation({ summary: "Get modifier group by ID" })
  async findOne(@CurrentCompany() companyId: string, @Param("id") id: string) {
    const data = await this.service.findById(companyId, id);
    return { data };
  }

  @Post()
  @ApiOperation({ summary: "Create modifier group" })
  async create(@CurrentCompany() companyId: string, @Body() body: unknown) {
    const dto: CreateModifierGroupDto = CreateModifierGroupSchema.parse(body);
    const data = await this.service.create(companyId, dto);
    return { data };
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update modifier group" })
  async update(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const dto: UpdateModifierGroupDto = UpdateModifierGroupSchema.parse(body);
    const data = await this.service.update(companyId, id, dto);
    return { data };
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete modifier group" })
  async remove(@CurrentCompany() companyId: string, @Param("id") id: string) {
    const data = await this.service.remove(companyId, id);
    return { data };
  }

  // Product attachments
  @Get("products/:productId")
  @ApiOperation({ summary: "List modifier groups for product" })
  async listForProduct(
    @CurrentCompany() companyId: string,
    @Param("productId") productId: string,
  ) {
    const data = await this.service.listForProduct(companyId, productId);
    return { data };
  }

  @Put("products/attach")
  @ApiOperation({ summary: "Attach modifier groups to product" })
  async attachToProduct(
    @CurrentCompany() companyId: string,
    @Body() body: unknown,
  ) {
    const dto: AttachProductModifierDto =
      AttachProductModifierSchema.parse(body);
    const data = await this.service.setProductGroups(companyId, dto);
    return { data };
  }
}
