// Sentry — HARUS di-import paling awal di main.ts (sebelum modul lain) supaya
// auto-instrumentation (HTTP, dll) terpasang. DSN dari env; kalau kosong,
// Sentry no-op. `dotenv/config` memastikan .env terbaca sebelum init (init
// jalan sebelum ConfigModule Nest dimuat).
import { config } from "dotenv";
import * as Sentry from "@sentry/nestjs";

// Muat .env sebelum init (instrument jalan sebelum ConfigModule Nest).
config();

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // Aktif hanya bila DSN diisi (no-op saat dev tanpa DSN).
  enabled: !!process.env.SENTRY_DSN,

  // Performance tracing — 10% transaksi. Sesuaikan untuk produksi trafik tinggi.
  tracesSampleRate: 0.1,

  environment: process.env.NODE_ENV ?? "development",

  // Set true sementara untuk debug inisialisasi.
  debug: false,
});
