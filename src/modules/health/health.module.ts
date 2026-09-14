import { Module } from "@nestjs/common";
import { EmbeddingModule } from "@/common/embedding/embedding.module";
import { HealthController } from "./health.controller";

@Module({
  imports: [EmbeddingModule],
  controllers: [HealthController],
})
export class HealthModule {}
