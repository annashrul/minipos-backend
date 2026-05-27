import { Module } from "@nestjs/common";
import { AutoJournalController } from "./auto-journal.controller";
import { AutoJournalRepository } from "./auto-journal.repository";
import { AutoJournalService } from "./auto-journal.service";

@Module({
  controllers: [AutoJournalController],
  providers: [AutoJournalRepository, AutoJournalService],
  exports: [AutoJournalService],
})
export class AutoJournalModule {}
