import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import {
  ListPlatformActivityLogsQuerySchema,
  type ListPlatformActivityLogsQueryDto,
} from "./dto/platform-notifications.dto";
import { ZodValidationPipe } from "../../common/pipes/zod.pipe";
import { PlatformOwnerGuard } from "../platform-subscriptions/platform-owner.guard";
import { PlatformNotificationsService } from "./platform-notifications.service";

@Controller("platform")
@UseGuards(PlatformOwnerGuard)
export class PlatformNotificationsController {
  constructor(
    private readonly platformNotifications: PlatformNotificationsService,
  ) {}

  @Get("activity-logs")
  async listActivityLogs(
    @Query(new ZodValidationPipe(ListPlatformActivityLogsQuerySchema))
    query: ListPlatformActivityLogsQueryDto,
  ) {
    const data = await this.platformNotifications.listActivityLogs(query);
    return { data };
  }

  @Get("notifications")
  async listNotifications() {
    const data = await this.platformNotifications.listNotifications();
    return { data };
  }
}
