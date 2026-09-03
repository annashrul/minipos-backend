// Run: node -r @swc-node/register -r tsconfig-paths/register prisma/apply-phase58.ts
//  (atau: npx tsx prisma/apply-phase58.ts)
//
// Menerapkan phase58_image_embedding.sql — kolom embedding pgvector di products.
// Idempotent: semua statement pakai IF NOT EXISTS, aman di-run berulang.
//
// CATATAN: runner ini TIDAK memakai pola apply-phase17.ts secara mentah.
// apply-phase17 mem-filter statement dengan `s.startsWith("--")`, sehingga
// statement yang DIDAHULUI blok komentar ikut terbuang. SQL phase58 penuh
// komentar penjelas, jadi di sini komentar dibuang PER-BARIS dulu, baru
// statement-nya dieksekusi.
import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const SQL_FILE = "phase58_image_embedding.sql";

function toStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((chunk) =>
      chunk
        .split(/\r?\n/)
        // Buang baris komentar. Tidak ada string literal ber-'--' di file ini,
        // jadi split per-baris aman.
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim(),
    )
    .filter((stmt) => stmt.length > 0);
}

async function main() {
  const sqlPath = path.join(__dirname, "migrations", "manual", SQL_FILE);
  const sql = fs.readFileSync(sqlPath, "utf8");
  const statements = toStatements(sql);

  const prisma = new PrismaClient();
  try {
    console.log(`[phase58] menerapkan ${statements.length} statement...`);
    for (const stmt of statements) {
      const label = stmt.replace(/\s+/g, " ").slice(0, 80);
      await prisma.$executeRawUnsafe(stmt);
      console.log(`  ok  ${label}`);
    }

    // Verifikasi hasil — bukan asumsi.
    const cols = await prisma.$queryRawUnsafe<
      Array<{ column_name: string; data_type: string; udt_name: string }>
    >(`
      SELECT column_name, data_type, udt_name
      FROM information_schema.columns
      WHERE table_name = 'products'
        AND column_name IN ('embedding', 'embeddedAt', 'embeddingModel', 'embeddedImageUrl')
      ORDER BY column_name
    `);
    console.log("[phase58] kolom terpasang:");
    for (const c of cols) {
      console.log(`  - ${c.column_name} (${c.data_type}/${c.udt_name})`);
    }

    const dim = await prisma.$queryRawUnsafe<Array<{ dim: number | null }>>(`
      SELECT atttypmod AS dim
      FROM pg_attribute
      WHERE attrelid = 'products'::regclass AND attname = 'embedding'
    `);
    console.log(`[phase58] dimensi vector = ${dim[0]?.dim ?? "?"}`);

    const idx = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'products' AND indexname LIKE 'idx_products_embed%'
      ORDER BY indexname
    `);
    console.log(
      `[phase58] index: ${idx.map((i) => i.indexname).join(", ") || "(kosong)"}`,
    );

    // View phase4/phase32 memakai kolom eksplisit — pastikan tetap hidup.
    const view = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT COUNT(*)::bigint AS n FROM vw_product_branch LIMIT 1`,
    );
    console.log(
      `[phase58] vw_product_branch masih valid (${Number(view[0].n)} baris)`,
    );

    console.log("[phase58] selesai.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
