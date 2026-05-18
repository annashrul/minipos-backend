import { Module } from "@nestjs/common";
import { RacksModule } from "../racks/racks.module";
import { StockController } from "./stock.controller";
import { StockService } from "./stock.service";
import { StockLedgerService } from "./stock-ledger.service";

@Module({
  imports: [RacksModule],
  controllers: [StockController],
  providers: [StockService, StockLedgerService],
  exports: [StockService, StockLedgerService],
})
export class StockModule {}
