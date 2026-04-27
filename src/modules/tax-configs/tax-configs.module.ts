import { Module } from "@nestjs/common";
import { TaxConfigsController } from "./tax-configs.controller";
import { TaxConfigsService } from "./tax-configs.service";

@Module({
  controllers: [TaxConfigsController],
  providers: [TaxConfigsService],
  exports: [TaxConfigsService],
})
export class TaxConfigsModule {}
