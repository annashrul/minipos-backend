import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ["log", "error", "warn", "debug"],
    // Raw body wajib untuk verifikasi HMAC signature webhook dari wa-service
    // (lihat WhatsappWebhookController). Tidak menonaktifkan JSON parsing —
    // Nest tetap parse + expose body, hanya menyimpan raw buffer di samping.
    rawBody: true,
  });

  app.setGlobalPrefix("api");
  app.useGlobalFilters(new AllExceptionsFilter());

  // CORS: comma-separated whitelist via CORS_ORIGINS. Items boleh:
  //   - exact origin   → "https://pos.example.com"
  //   - wildcard host  → "https://*.vercel.app"  (* = subdomain)
  //   - regex literal  → "/^https:\\/\\/.*\\.example\\.com$/"
  const corsRaw =
    process.env.CORS_ORIGINS ??
    process.env.WEB_ORIGIN ??
    "http://localhost:3000";
  const allowItems = corsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allowMatchers: Array<(o: string) => boolean> = allowItems.map((entry) => {
    if (entry.startsWith("/") && entry.endsWith("/") && entry.length > 2) {
      const re = new RegExp(entry.slice(1, -1));
      return (o: string) => re.test(o);
    }
    if (entry.includes("*")) {
      // Convert wildcard to regex (escape regex chars except *)
      const escaped = entry.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
      const re = new RegExp(`^${escaped}$`);
      return (o: string) => re.test(o);
    }
    return (o: string) => o === entry;
  });
  app.enableCors({
    origin: (origin, callback) => {
      // Allow same-origin / non-browser requests (no Origin header)
      if (!origin) return callback(null, true);
      const ok = allowMatchers.some((fn) => fn(origin));
      // Pass `false` instead of throwing — clean 403/no-CORS response,
      // not 500 internal error.
      callback(null, ok);
    },
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
