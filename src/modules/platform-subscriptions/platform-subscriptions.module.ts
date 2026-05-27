import { Module } from "@nestjs/common";
import { PlatformSubscriptionsController } from "./platform-subscriptions.controller";
import { PlatformSubscriptionsRepository } from "./platform-subscriptions.repository";
import { PlatformSubscriptionsService } from "./platform-subscriptions.service";

@Module({
  controllers: [PlatformSubscriptionsController],
  providers: [PlatformSubscriptionsService, PlatformSubscriptionsRepository],
  exports: [PlatformSubscriptionsService],
})
export class PlatformSubscriptionsModule {}
