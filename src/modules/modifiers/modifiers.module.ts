import { Module } from "@nestjs/common";
import { ModifiersController } from "./modifiers.controller";
import { ModifiersService } from "./modifiers.service";
import { ModifiersRepository } from "./modifiers.repository";

@Module({
  controllers: [ModifiersController],
  providers: [ModifiersService, ModifiersRepository],
})
export class ModifiersModule {}
