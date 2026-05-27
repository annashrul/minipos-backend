import { Module } from "@nestjs/common";
import {
  RecipesController,
  RecipesQueryController,
} from "./recipes.controller";
import { RecipesService } from "./recipes.service";
import { RecipesRepository } from "./recipes.repository";

@Module({
  controllers: [RecipesController, RecipesQueryController],
  providers: [RecipesService, RecipesRepository],
  exports: [RecipesService],
})
export class RecipesModule {}
