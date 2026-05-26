import { Module } from "@nestjs/common";
import { InstallmentsController } from "./installments.controller";
import { InstallmentsService } from "./installments.service";
import { InstallmentsRepository } from "./installments.repository";

@Module({
  controllers: [InstallmentsController],
  providers: [InstallmentsService, InstallmentsRepository],
  exports: [InstallmentsService],
})
export class InstallmentsModule {}
