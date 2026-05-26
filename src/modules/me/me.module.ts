import { Module } from "@nestjs/common";
import { MeController } from "./me.controller";
import { MeService } from "./me.service";
import { MeRepository } from "./me.repository";
import { UsersModule } from "../users/users.module";

@Module({
  imports: [UsersModule],
  controllers: [MeController],
  providers: [MeService, MeRepository],
  exports: [MeService],
})
export class MeModule {}
