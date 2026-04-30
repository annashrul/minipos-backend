import { Module } from "@nestjs/common";
import { JournalsContext } from "./internal/journals-context.service";
import { JournalsCrudService } from "./internal/journals-crud.service";
import { JournalsLifecycleService } from "./internal/journals-lifecycle.service";
import { JournalsController } from "./journals.controller";
import { JournalsService } from "./journals.service";

@Module({
  controllers: [JournalsController],
  providers: [
    JournalsService,
    JournalsCrudService,
    JournalsLifecycleService,
    JournalsContext,
  ],
  exports: [JournalsService],
})
export class JournalsModule {}
