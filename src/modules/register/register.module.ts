import { Module } from "@nestjs/common";
import { RegisterController } from "./register.controller";
import { RegisterService } from "./register.service";

@Module({
  controllers: [RegisterController],
  providers: [RegisterService],
  exports: [RegisterService],
})
export class RegisterModule {}
