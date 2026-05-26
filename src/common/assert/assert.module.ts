import { Global, Module } from "@nestjs/common";
import { AssertService } from "./assert.service";

@Global()
@Module({
  providers: [AssertService],
  exports: [AssertService],
})
export class AssertModule {}
