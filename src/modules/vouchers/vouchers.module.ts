import { Module } from "@nestjs/common";
import { VouchersController } from "./vouchers.controller";
import { VouchersService } from "./vouchers.service";
import { VouchersRepository } from "./vouchers.repository";

@Module({
  controllers: [VouchersController],
  providers: [VouchersService, VouchersRepository],
  exports: [VouchersService],
})
export class VouchersModule {}
