import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import {
  ListPlatformActivityLogsQuerySchema,
  type ListPlatformActivityLogsQueryDto,
} from "./dto/platform-notifications.dto";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodQuery } from "@/common/swagger/zod-swagger";
import { PlatformOwnerGuard } from "@/modules/platform-subscriptions/platform-owner.guard";
import { PlatformNotificationsService } from "./platform-notifications.service";

@ApiTags("Platform")
@ApiBearerAuth()
@Controller("platform")
@UseGuards(PlatformOwnerGuard)
export class PlatformNotificationsController {
  constructor(
    private readonly platformNotifications: PlatformNotificationsService,
  ) {}

  @Get("activity-logs")
  @ApiOperation({ summary: "List platform activity logs" })
  @ApiZodQuery(ListPlatformActivityLogsQuerySchema)
  async listActivityLogs(
    @Query(new ZodValidationPipe(ListPlatformActivityLogsQuerySchema))
    query: ListPlatformActivityLogsQueryDto,
  ) {
    const data = await this.platformNotifications.listActivityLogs(query);
    return { data };
  }

  @Get("notifications")
  @ApiOperation({ summary: "List platform notifications" })
  async listNotifications() {
    const data = await this.platformNotifications.listNotifications();
    return { data };
  }
}
