// WAJIB paling atas — inisialisasi Sentry sebelum modul/instrumentation lain.
import "./instrument";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ["log", "error", "warn", "debug"],
    // Raw body wajib untuk verifikasi HMAC signature webhook dari wa-service
    // (lihat WhatsappWebhookController). Tidak menonaktifkan JSON parsing —
    // Nest tetap parse + expose body, hanya menyimpan raw buffer di samping.
    rawBody: true,
  });

  // Naikkan limit body JSON (default Express 100kb). Pencarian via FOTO mengirim
  // gambar base64 (~beberapa ratus kB pada 768px). useBodyParser tetap menjaga
  // rawBody untuk verifikasi HMAC webhook.
  app.useBodyParser("json", { limit: "5mb" });
  app.useBodyParser("urlencoded", { limit: "5mb", extended: true });

  app.setGlobalPrefix("api");
  app.useGlobalFilters(new AllExceptionsFilter());

  app.enableCors({
    origin: true,
    credentials: true,
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle("MiniPOS API")
    .setDescription("Backend API untuk sistem Point of Sale MiniPOS")
    .setVersion("1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("api/docs", app, document);

  // Cloud Run injects PORT (default 8080); fallback ke 4000 untuk dev lokal.
  const port = parseInt(process.env.PORT ?? "4000", 10);
  // Listen di 0.0.0.0 — wajib untuk container (Cloud Run, Docker).
  await app.listen(port, "0.0.0.0");
  Logger.log(`API listening on port ${port} (prefix: /api)`, "Bootstrap");
}

bootstrap();
