import { Module } from "@nestjs/common";
import { RacksModule } from "../racks/racks.module";
import { PurchasesController } from "./purchases.controller";
import { PurchasesRepository } from "./purchases.repository";
import { PurchasesService } from "./purchases.service";

@Module({
  imports: [RacksModule],
  controllers: [PurchasesController],
  providers: [PurchasesRepository, PurchasesService],
  exports: [PurchasesService],
})
export class PurchasesModule {}
