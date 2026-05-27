import { Module } from "@nestjs/common";
import { RecurringJournalsController } from "./recurring-journals.controller";
import { RecurringJournalsRepository } from "./recurring-journals.repository";
import { RecurringJournalsService } from "./recurring-journals.service";

@Module({
  controllers: [RecurringJournalsController],
  providers: [RecurringJournalsRepository, RecurringJournalsService],
  exports: [RecurringJournalsService],
})
export class RecurringJournalsModule {}
