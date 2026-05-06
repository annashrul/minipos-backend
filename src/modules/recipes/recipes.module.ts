import { Module } from "@nestjs/common";
import {
  RecipesController,
  RecipesQueryController,
} from "./recipes.controller";
import { RecipesService } from "./recipes.service";

@Module({
  controllers: [RecipesController, RecipesQueryController],
  providers: [RecipesService],
  exports: [RecipesService],
})
export class RecipesModule {}
