import { Module } from "@nestjs/common";
import { RealtimeModule } from "../realtime/realtime.module";
import { PublicTableService } from "./internal/public-table.service";
import { TableOrderManagementService } from "./internal/table-order-management.service";
import { TableOrderSubmitService } from "./internal/table-order-submit.service";
import { TableSessionService } from "./internal/table-session.service";
import {
  PublicTableOrdersController,
  TableOrdersController,
  TableSessionsController,
} from "./table-orders.controller";
import { TableOrdersService } from "./table-orders.service";

@Module({
  imports: [RealtimeModule],
  controllers: [
    PublicTableOrdersController,
    TableOrdersController,
    TableSessionsController,
  ],
  providers: [
    TableOrdersService,
    PublicTableService,
    TableOrderSubmitService,
    TableOrderManagementService,
    TableSessionService,
  ],
  exports: [TableOrdersService],
})
export class TableOrdersModule {}
