import { Module } from "@nestjs/common";
import { StockOpnameController } from "./stock-opname.controller";
import { StockOpnameService } from "./stock-opname.service";

@Module({
  controllers: [StockOpnameController],
  providers: [StockOpnameService],
  exports: [StockOpnameService],
})
export class StockOpnameModule {}
