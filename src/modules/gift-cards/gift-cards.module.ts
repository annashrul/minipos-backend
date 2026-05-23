import { Module } from "@nestjs/common";
import { GiftCardsController } from "./gift-cards.controller";
import { GiftCardsService } from "./gift-cards.service";
import { GiftCardsRepository } from "./gift-cards.repository";

@Module({
  controllers: [GiftCardsController],
  providers: [GiftCardsService, GiftCardsRepository],
  exports: [GiftCardsService],
})
export class GiftCardsModule {}
