import { Module } from "@nestjs/common";
import { ReturnsController } from "./returns.controller";
import { ReturnsService } from "./returns.service";
import { ReturnApprovalService } from "./return-approval.service";
import { ReturnsRepository } from "./returns.repository";

@Module({
  controllers: [ReturnsController],
  providers: [ReturnsService, ReturnApprovalService, ReturnsRepository],
  exports: [ReturnsService],
})
export class ReturnsModule {}
