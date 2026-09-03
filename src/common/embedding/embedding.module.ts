import { Global, Module } from "@nestjs/common";
import { EmbeddingClient } from "./embedding.client";

// @Global supaya ProductsModule (hook create/update) dan ImageSearchModule
// bisa inject EmbeddingClient tanpa import berulang — pola sama dengan
// PrismaModule.
@Global()
@Module({
  providers: [EmbeddingClient],
  exports: [EmbeddingClient],
})
export class EmbeddingModule {}
