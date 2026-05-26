import { Module } from "@nestjs/common";
import { PlatformNotificationsController } from "./platform-notifications.controller";
import { PlatformNotificationsRepository } from "./platform-notifications.repository";
import { PlatformNotificationsService } from "./platform-notifications.service";

@Module({
  controllers: [PlatformNotificationsController],
  providers: [PlatformNotificationsService, PlatformNotificationsRepository],
  exports: [PlatformNotificationsService],
})
export class PlatformNotificationsModule {}
