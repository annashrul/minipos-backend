import { Module } from "@nestjs/common";
import { AutoJournalController } from "./auto-journal.controller";
import { AutoJournalService } from "./auto-journal.service";

@Module({
  controllers: [AutoJournalController],
  providers: [AutoJournalService],
  exports: [AutoJournalService],
})
export class AutoJournalModule {}
