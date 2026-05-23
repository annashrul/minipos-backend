import { Module } from "@nestjs/common";
import { TablesController } from "./tables.controller";
import { TablesService } from "./tables.service";
import { TablesRepository } from "./tables.repository";

@Module({
  controllers: [TablesController],
  providers: [TablesService, TablesRepository],
  exports: [TablesService],
})
export class TablesModule {}
