import { Injectable, OnModuleInit } from "@nestjs/common";
import { v2 as cloudinary } from "cloudinary";

@Injectable()
export class UploadsService implements OnModuleInit {
  onModuleInit() {
    cloudinary.config();
  }

  uploadImage(
    buffer: Buffer,
    folder: string,
  ): Promise<{ url: string; publicId: string }> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: "image",
          transformation: [
            {
              width: 800,
              height: 800,
              crop: "limit",
              quality: "auto",
              format: "webp",
            },
          ],
        },
        (error, result) => {
          if (error || !result) {
            reject(error ?? new Error("Upload failed"));
            return;
          }
          resolve({ url: result.secure_url, publicId: result.public_id });
        },
      );
      stream.end(buffer);
    });
  }

  async deleteImage(publicId: string): Promise<void> {
    try {
      await cloudinary.uploader.destroy(publicId);
    } catch {
      // ignore
    }
  }
}
