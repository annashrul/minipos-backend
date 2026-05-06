import { Module } from "@nestjs/common";
import { StockController } from "./stock.controller";
import { StockService } from "./stock.service";
import { StockLedgerService } from "./stock-ledger.service";

@Module({
  controllers: [StockController],
  providers: [StockService, StockLedgerService],
  exports: [StockService, StockLedgerService],
})
export class StockModule {}
