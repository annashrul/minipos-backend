import { Module } from "@nestjs/common";
import { RegisterModule } from "@/modules/register/register.module";
import { PlatformSubscriptionsController } from "./platform-subscriptions.controller";
import { PlatformSubscriptionsRepository } from "./platform-subscriptions.repository";
import { PlatformSubscriptionsService } from "./platform-subscriptions.service";

@Module({
  imports: [RegisterModule],
  controllers: [PlatformSubscriptionsController],
  providers: [PlatformSubscriptionsService, PlatformSubscriptionsRepository],
  exports: [PlatformSubscriptionsService],
})
export class PlatformSubscriptionsModule {}
