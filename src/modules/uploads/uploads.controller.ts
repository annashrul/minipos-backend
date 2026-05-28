import {
  BadRequestException,
  Controller,
  Delete,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiConsumes,
  ApiBody,
} from "@nestjs/swagger";
import { FileInterceptor } from "@nestjs/platform-express";
import { UploadsService } from "./uploads.service";

interface UploadedFilePayload {
  buffer: Buffer;
  size: number;
  mimetype: string;
}

const ALLOWED = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);
const MAX_BYTES = 5 * 1024 * 1024;

@ApiTags("Uploads")
@ApiBearerAuth()
@Controller("uploads")
export class UploadsController {
  constructor(private readonly service: UploadsService) {}

  @Post("image")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_BYTES } }))
  @ApiOperation({ summary: "Upload image" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: { file: { type: "string", format: "binary" } },
    },
  })
  async uploadImage(
    @UploadedFile() file: UploadedFilePayload | undefined,
  ) {
    if (!file || !file.buffer || file.size === 0) {
      throw new BadRequestException("File tidak ditemukan");
    }
    if (!ALLOWED.has(file.mimetype)) {
      throw new BadRequestException(
        "Format file tidak didukung. Gunakan JPG, PNG, atau WebP",
      );
    }
    if (file.size > MAX_BYTES) {
      throw new BadRequestException("Ukuran file maksimal 5MB");
    }
    const folder = "pos/products";
    const result = await this.service.uploadImage(file.buffer, folder);
    return { url: result.url, publicId: result.publicId };
  }

  @Delete("image/:publicId")
  @ApiOperation({ summary: "Delete image" })
  async deleteImage(@Param("publicId") publicId: string) {
    await this.service.deleteImage(decodeURIComponent(publicId));
    return { success: true };
  }
}
