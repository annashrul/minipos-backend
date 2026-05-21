import { Global, Module } from "@nestjs/common";
import { RealtimeController } from "./realtime.controller";
import { RealtimeService } from "./realtime.service";

/**
 * Global module — RealtimeService bisa di-inject di service mana saja
 * tanpa explicit import per-module.
 */
@Global()
@Module({
  controllers: [RealtimeController],
  providers: [RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
