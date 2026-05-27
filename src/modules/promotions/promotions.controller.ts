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
  CreatePromotionSchema,
  ListPromotionsQuerySchema,
  TogglePromotionSchema,
  UpdatePromotionSchema,
  type CreatePromotionDto,
  type ListPromotionsQueryDto,
  type TogglePromotionDto,
  type UpdatePromotionDto,
} from "./dto/promotions.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { PromotionsService } from "./promotions.service";

@Controller("promotions")
@UseGuards(AccessGuard)
export class PromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Get()
  @RequireAccess("promotions", "view")
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListPromotionsQuerySchema))
    query: ListPromotionsQueryDto,
  ) {
    const data = await this.promotions.list(companyId, query);
    return { data };
  }

  @Get("stats")
  @RequireAccess("promotions", "view")
  async stats(@CurrentCompany() companyId: string) {
    const data = await this.promotions.stats(companyId);
    return { data };
  }

  @Get(":id")
  @RequireAccess("promotions", "view")
  async findOne(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.promotions.findById(companyId, id);
    return { data };
  }

  @Post()
  @RequireAccess("promotions", "create")
  async create(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(CreatePromotionSchema))
    body: CreatePromotionDto,
  ) {
    const data = await this.promotions.create(companyId, body);
    return { data };
  }

  @Patch(":id")
  @RequireAccess("promotions", "update")
  async update(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdatePromotionSchema))
    body: UpdatePromotionDto,
  ) {
    const data = await this.promotions.update(companyId, id, body);
    return { data };
  }

  @Patch(":id/toggle")
  @RequireAccess("promotions", "update")
  async toggle(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(TogglePromotionSchema))
    body: TogglePromotionDto,
  ) {
    const data = await this.promotions.toggle(companyId, id, body.isActive);
    return { data };
  }

  @Delete(":id")
  @RequireAccess("promotions", "delete")
  async delete(
    @CurrentCompany() companyId: string,
    @Param("id") id: string,
  ) {
    const data = await this.promotions.delete(companyId, id);
    return { data };
  }
}
