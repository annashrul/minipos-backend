import { Module } from "@nestjs/common";
import { StockTransfersController } from "./stock-transfers.controller";
import { StockTransfersService } from "./stock-transfers.service";
import { StockTransfersRepository } from "./stock-transfers.repository";

@Module({
  controllers: [StockTransfersController],
  providers: [StockTransfersService, StockTransfersRepository],
  exports: [StockTransfersService],
})
export class StockTransfersModule {}
