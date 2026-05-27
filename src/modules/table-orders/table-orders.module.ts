import { Module } from "@nestjs/common";
import { RealtimeModule } from "@/modules/realtime/realtime.module";
import {
  PublicTableOrdersController,
  TableOrdersController,
  TableSessionsController,
} from "./table-orders.controller";
import { TableOrdersRepository } from "./table-orders.repository";
import { TableOrdersService } from "./table-orders.service";
import { TablePublicService } from "./table-public.service";
import { TableOrderKasirService } from "./table-order-kasir.service";
import { TableOrderSubmitService } from "./table-order-submit.service";

@Module({
  imports: [RealtimeModule],
  controllers: [
    PublicTableOrdersController,
    TableOrdersController,
    TableSessionsController,
  ],
  providers: [
    TableOrdersService,
    TablePublicService,
    TableOrderKasirService,
    TableOrderSubmitService,
    TableOrdersRepository,
  ],
  exports: [TableOrdersService],
})
export class TableOrdersModule {}
