import { Global, Module } from "@nestjs/common";
import { RealtimeController } from "./realtime.controller";
import { RealtimeService } from "./realtime.service";
import { RealtimeGateway } from "./realtime.gateway";

/**
 * Global module — RealtimeService bisa di-inject di service mana saja
 * tanpa explicit import per-module. RealtimeGateway expose Socket.IO
 * server di namespace `/events` untuk browser client.
 */
@Global()
@Module({
  controllers: [RealtimeController],
  providers: [RealtimeGateway, RealtimeService],
  exports: [RealtimeService, RealtimeGateway],
})
export class RealtimeModule {}
