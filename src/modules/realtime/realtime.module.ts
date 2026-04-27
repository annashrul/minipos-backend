import { Global, Module } from "@nestjs/common";
import { RealtimeService } from "./realtime.service";

/**
 * Global module — RealtimeService bisa di-inject di service mana saja
 * tanpa explicit import per-module.
 */
@Global()
@Module({
  providers: [RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
