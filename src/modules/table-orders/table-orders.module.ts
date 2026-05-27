import { Module } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module";
import {
  PublicTableOrdersController,
  TableOrdersController,
  TableSessionsController,
} from "./table-orders.controller";
import { TableOrdersRepository } from "./table-orders.repository";
import { TableOrdersService } from "./table-orders.service";

@Module({
  imports: [RealtimeModule],
  controllers: [
    PublicTableOrdersController,
    TableOrdersController,
    TableSessionsController,
  ],
  providers: [TableOrdersService, TableOrdersRepository],
  exports: [TableOrdersService],
})
export class TableOrdersModule {}
