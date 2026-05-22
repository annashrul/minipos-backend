import { Global, Module } from "@nestjs/common";
import { WaServiceClient } from "./wa-service.client";

// Global supaya semua module yang butuh WaServiceClient tidak perlu
// import module ini secara eksplisit. Pure HTTP client, no DB deps.
@Global()
@Module({
  providers: [WaServiceClient],
  exports: [WaServiceClient],
})
export class WaServiceModule {}
