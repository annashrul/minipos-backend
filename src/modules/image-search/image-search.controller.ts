import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "@/common/pipes/zod.pipe";
import { ApiZodBody } from "@/common/swagger/zod-swagger";
import { AccessGuard } from "@/modules/auth/access.guard";
import { CurrentCompany } from "@/modules/auth/current-company.decorator";
import { RequireAccess } from "@/modules/auth/require-access.decorator";
import {
  ImageSearchQuerySchema,
  ImageSearchTextQuerySchema,
  type ImageSearchQueryDto,
  type ImageSearchTextQueryDto,
} from "./dto/image-search.dto";
import { ImageSearchService } from "./image-search.service";

// Otorisasi memakai menu key "products" yang SUDAH ter-seed di app_menus.
// Sengaja tidak membuat key baru "image-search": access.guard.ts baris 75
// (`if (!menu) return true;`) FAIL-OPEN untuk menu yang belum di-seed, jadi
// key baru tanpa seeding justru membuat endpoint ini tanpa proteksi.
@ApiTags("Image Search")
@ApiBearerAuth()
@Controller("image-search")
@UseGuards(AccessGuard)
export class ImageSearchController {
  constructor(private readonly service: ImageSearchService) {}

  @Post("query")
  @RequireAccess("products", "view")
  @ApiOperation({
    summary: "Cari produk dari foto memakai similarity vektor (pgvector)",
  })
  @ApiZodBody(ImageSearchQuerySchema)
  async query(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(ImageSearchQuerySchema))
    body: ImageSearchQueryDto,
  ) {
    const data = await this.service.search(companyId, body);
    return { data };
  }

  @Post("text")
  @RequireAccess("products", "view")
  @ApiOperation({
    summary:
      "Cari produk dari deskripsi teks memakai text tower SigLIP (jaring terakhir foto)",
  })
  @ApiZodBody(ImageSearchTextQuerySchema)
  async queryText(
    @CurrentCompany() companyId: string,
    @Body(new ZodValidationPipe(ImageSearchTextQuerySchema))
    body: ImageSearchTextQueryDto,
  ) {
    const data = await this.service.searchByText(companyId, body);
    return { data };
  }

  @Get("status")
  @RequireAccess("products", "view")
  @ApiOperation({
    summary: "Status index embedding (berapa produk sudah di-embed)",
  })
  async status(@CurrentCompany() companyId: string) {
    const data = await this.service.status(companyId);
    return { data };
  }
}
