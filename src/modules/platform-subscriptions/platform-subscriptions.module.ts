import { Module } from "@nestjs/common";
import { PlatformSubscriptionsController } from "./platform-subscriptions.controller";
import { PlatformSubscriptionsService } from "./platform-subscriptions.service";

@Module({
  controllers: [PlatformSubscriptionsController],
  providers: [PlatformSubscriptionsService],
  exports: [PlatformSubscriptionsService],
})
export class PlatformSubscriptionsModule {}
