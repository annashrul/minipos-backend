import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import {
  ListSettingsQuerySchema,
  UpsertSettingSchema,
  UpsertSettingsBulkSchema,
  type ListSettingsQueryDto,
  type UpsertSettingDto,
  type UpsertSettingsBulkDto,
} from "./dto/settings.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody, ApiZodQuery } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import { SettingsService } from "./settings.service";

@ApiTags("Settings")
@ApiBearerAuth()
@Controller("settings")
@UseGuards(AccessGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequireAccess("settings", "view")
  @ApiOperation({ summary: "List settings" })
  @ApiZodQuery(ListSettingsQuerySchema)
  async list(
    @CurrentCompany() companyId: string,
    @Query(new ZodValidationPipe(ListSettingsQuerySchema))
    query: ListSettingsQueryDto,
  ) {
    const data = await this.settings.list(companyId, query);
    return { data };
  }

  @Put()
  @RequireAccess("settings", "update")
  @ApiOperation({ summary: "Upsert setting" })
  @ApiZodBody(UpsertSettingSchema)
  async upsert(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(UpsertSettingSchema)) body: UpsertSettingDto,
  ) {
    const data = await this.settings.upsert(companyId, body);
    return { data };
  }

  @Post("bulk")
  @RequireAccess("settings", "update")
  @ApiOperation({ summary: "Bulk upsert settings" })
  @ApiZodBody(UpsertSettingsBulkSchema)
  async upsertBulk(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(UpsertSettingsBulkSchema))
    body: UpsertSettingsBulkDto,
  ) {
    const data = await this.settings.upsertBulk(companyId, body);
    return { data };
  }

  @Delete()
  @RequireAccess("settings", "delete")
  @ApiOperation({ summary: "Delete setting" })
  async delete(
    @CurrentCompany() companyId: string,
    @Query("key") key: string,
    @Query("branchId") branchId?: string,
  ) {
    const data = await this.settings.delete(companyId, key, branchId ?? null);
    return { data };
  }
}
