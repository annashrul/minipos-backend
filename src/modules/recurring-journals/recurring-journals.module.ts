import { Module } from "@nestjs/common";
import { RecurringJournalsController } from "./recurring-journals.controller";
import { RecurringJournalsService } from "./recurring-journals.service";

@Module({
  controllers: [RecurringJournalsController],
  providers: [RecurringJournalsService],
  exports: [RecurringJournalsService],
})
export class RecurringJournalsModule {}
