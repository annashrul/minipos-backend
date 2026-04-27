import { Module } from "@nestjs/common";
import { PlatformNotificationsController } from "./platform-notifications.controller";
import { PlatformNotificationsService } from "./platform-notifications.service";

@Module({
  controllers: [PlatformNotificationsController],
  providers: [PlatformNotificationsService],
  exports: [PlatformNotificationsService],
})
export class PlatformNotificationsModule {}
