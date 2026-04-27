import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ["log", "error", "warn", "debug"],
  });

  app.setGlobalPrefix("api");
  app.useGlobalFilters(new AllExceptionsFilter());

  // Allow comma-separated list in CORS_ORIGINS (mis. https://pos.example.com,https://staging.example.com)
  const corsRaw =
    process.env.CORS_ORIGINS ??
    process.env.WEB_ORIGIN ??
    "http://localhost:3000";
  const corsList = corsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsList.length === 1 ? corsList[0] : corsList,
    credentials: true,
  });

  // Cloud Run injects PORT (default 8080); fallback ke 4000 untuk dev lokal.
  const port = parseInt(process.env.PORT ?? "4000", 10);
  // Listen di 0.0.0.0 — wajib untuk container (Cloud Run, Docker).
  await app.listen(port, "0.0.0.0");
  Logger.log(`API listening on port ${port} (prefix: /api)`, "Bootstrap");
}

bootstrap();
