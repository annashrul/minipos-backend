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
import { CurrentCompany } from "../auth/current-company.decorator";
import {
  CreateModifierGroupSchema,
  ListModifierGroupsQuerySchema,
  UpdateModifierGroupSchema,
  AttachProductModifierSchema,
  type CreateModifierGroupDto,
  type ListModifierGroupsQueryDto,
  type UpdateModifierGroupDto,
  type AttachProductModifierDto,
} from "@/contracts";
import { ModifiersService } from "./modifiers.service";

@Controller("modifiers")
export class ModifiersController {
  constructor(private readonly service: ModifiersService) {}

  @Get()
  async list(
    @CurrentCompany() companyId: string,
    @Query() query: Record<string, unknown>,
  ) {
    const parsed: ListModifierGroupsQueryDto =
      ListModifierGroupsQuerySchema.parse(query);
    const data = await this.service.list(companyId, parsed);
    return { data };
  }

  @Get(":id")
  async findOne(@CurrentCompany() companyId: string, @Param("id") id: string) {
    const data = await this.service.findById(companyId, id);
    return { data };
  }

  @Post()
  async create(@CurrentCompany() companyId: string, @Body() body: unknown) {
    const dto: CreateModifierGroupDto = CreateModifierGroupSchema.parse(body);
    const data = await this.service.create(companyId, dto);
    return { data };
  }

  @Patch(":id")
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
  async remove(@CurrentCompany() companyId: string, @Param("id") id: string) {
    const data = await this.service.remove(companyId, id);
    return { data };
  }

  // Product attachments
  @Get("products/:productId")
  async listForProduct(
    @CurrentCompany() companyId: string,
    @Param("productId") productId: string,
  ) {
    const data = await this.service.listForProduct(companyId, productId);
    return { data };
  }

  @Put("products/attach")
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
