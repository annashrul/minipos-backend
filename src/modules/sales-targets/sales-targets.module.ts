import { Module } from "@nestjs/common";
import { SalesTargetsController } from "./sales-targets.controller";
import { SalesTargetsService } from "./sales-targets.service";

@Module({
  controllers: [SalesTargetsController],
  providers: [SalesTargetsService],
  exports: [SalesTargetsService],
})
export class SalesTargetsModule {}
