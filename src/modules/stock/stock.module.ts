import { Module } from "@nestjs/common";
import { RacksModule } from "@/modules/racks/racks.module";
import { StockController } from "./stock.controller";
import { StockService } from "./stock.service";
import { StockLedgerService } from "./stock-ledger.service";
import { StockRepository } from "./stock.repository";

@Module({
  imports: [RacksModule],
  controllers: [StockController],
  providers: [StockService, StockLedgerService, StockRepository],
  exports: [StockService, StockLedgerService],
})
export class StockModule {}
