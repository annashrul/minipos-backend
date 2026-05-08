// Run: npx ts-node prisma/apply-phase17.ts
// Applies phase17_promotion_trigger_products.sql via Prisma DIRECT connection.
// Idempotent: SQL uses CREATE TABLE IF NOT EXISTS.
// Tip: jika sudah jalan via `npx prisma db execute --file ...`, skrip ini cuma
// re-apply (no-op).
import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const sqlPath = path.join(
    __dirname,
    "migrations",
    "manual",
    "phase17_promotion_trigger_products.sql",
  );
  const sql = fs.readFileSync(sqlPath, "utf8");

  const prisma = new PrismaClient();
  try {
    console.log("[phase17] applying...");
    // Split per statement biar Prisma executeRawUnsafe happy.
    const statements = sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith("--"));
    for (const stmt of statements) {
      await prisma.$executeRawUnsafe(stmt);
    }
    console.log("[phase17] ok — promotion_trigger_products siap");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
