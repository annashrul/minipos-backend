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
import {
  ListSettingsQuerySchema,
  UpsertSettingSchema,
  UpsertSettingsBulkSchema,
  type ListSettingsQueryDto,
  type UpsertSettingDto,
  type UpsertSettingsBulkDto,
} from "@/contracts";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { AccessGuard } from "../auth/access.guard";
import { CurrentCompany } from "../auth/current-company.decorator";
import { RequireAccess } from "../auth/require-access.decorator";
import { SettingsService } from "./settings.service";

@Controller("settings")
@UseGuards(AccessGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequireAccess("settings", "view")
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
  async upsert(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(UpsertSettingSchema)) body: UpsertSettingDto,
  ) {
    const data = await this.settings.upsert(companyId, body);
    return { data };
  }

  @Post("bulk")
  @RequireAccess("settings", "update")
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
  async delete(
    @CurrentCompany() companyId: string,
    @Query("key") key: string,
    @Query("branchId") branchId?: string,
  ) {
    const data = await this.settings.delete(companyId, key, branchId ?? null);
    return { data };
  }
}
