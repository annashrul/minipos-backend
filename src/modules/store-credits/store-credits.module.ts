import { Module } from "@nestjs/common";
import { StoreCreditsController } from "./store-credits.controller";
import { StoreCreditsService } from "./store-credits.service";

@Module({
  controllers: [StoreCreditsController],
  providers: [StoreCreditsService],
  exports: [StoreCreditsService],
})
export class StoreCreditsModule {}
