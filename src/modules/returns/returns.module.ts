import { Module } from "@nestjs/common";
import { ReturnsController } from "./returns.controller";
import { ReturnsService } from "./returns.service";
import { ReturnsRepository } from "./returns.repository";

@Module({
  controllers: [ReturnsController],
  providers: [ReturnsService, ReturnsRepository],
  exports: [ReturnsService],
})
export class ReturnsModule {}
