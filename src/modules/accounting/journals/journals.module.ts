import { Module } from "@nestjs/common";
import { JournalsController } from "./journals.controller";
import { JournalsService } from "./journals.service";

@Module({
  controllers: [JournalsController],
  providers: [JournalsService],
  exports: [JournalsService],
})
export class JournalsModule {}
