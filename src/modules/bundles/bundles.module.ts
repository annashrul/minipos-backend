import { Module } from "@nestjs/common";
import { BundlesController } from "./bundles.controller";
import { BundlesRepository } from "./bundles.repository";
import { BundlesService } from "./bundles.service";

@Module({
  controllers: [BundlesController],
  providers: [BundlesService, BundlesRepository],
  exports: [BundlesService],
})
export class BundlesModule {}
