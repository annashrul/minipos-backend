import { Module } from "@nestjs/common";
import { RacksModule } from "../racks/racks.module";
import { StockOpnameController } from "./stock-opname.controller";
import { StockOpnameRepository } from "./stock-opname.repository";
import { StockOpnameService } from "./stock-opname.service";

@Module({
  imports: [RacksModule],
  controllers: [StockOpnameController],
  providers: [StockOpnameService, StockOpnameRepository],
  exports: [StockOpnameService],
})
export class StockOpnameModule {}
