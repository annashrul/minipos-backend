import { Module } from "@nestjs/common";
import { SalesTargetsController } from "./sales-targets.controller";
import { SalesTargetsService } from "./sales-targets.service";
import { SalesTargetsRepository } from "./sales-targets.repository";

@Module({
  controllers: [SalesTargetsController],
  providers: [SalesTargetsService, SalesTargetsRepository],
  exports: [SalesTargetsService],
})
export class SalesTargetsModule {}
