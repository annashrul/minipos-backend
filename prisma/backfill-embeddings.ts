// Backfill embedding gambar untuk produk yang sudah ada.
//
// Jalankan: pnpm db:backfill:embeddings [--company=<id|slug|nama>] [--batch=16]
//                                       [--limit=N] [--dry-run] [--force]
//
// Sifat:
//   * RESUMABLE — kriteria pilih = `embedding IS NULL OR "embeddedImageUrl"
//     IS DISTINCT FROM "imageUrl" OR "embeddingModel" IS DISTINCT FROM
//     <model+preprocessing yang dilaporkan /health>`. Produk yang gagal tetap
//     terpilih di run berikutnya, jadi cukup jalankan ulang. Klausa model
//     membuat perubahan pipeline embedding ikut ter-backfill tanpa --force.
//   * Gambar Cloudinary di-transform ke w_384,c_fit,f_jpg sebelum dikirim ke
//     ai-service → unduhan jauh lebih kecil, model tetap resize ke 224px.
//   * Kegagalan per-produk dicatat, tidak menghentikan proses.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Row = {
  id: string;
  code: string;
  name: string;
  imageUrl: string;
  companyId: string;
};

type EmbedResponse = {
  vectors: number[][];
  model: string;
  dim: number;
  failed?: Array<{ index: number; reason: string }>;
};

// ─── Argumen CLI ──────────────────────────────────────────────────
function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const COMPANY = arg("company");
const BATCH = Math.max(1, Number.parseInt(arg("batch") ?? "16", 10) || 16);
const LIMIT = Number.parseInt(arg("limit") ?? "0", 10) || 0;
const DRY_RUN = flag("dry-run");
const FORCE = flag("force");

const AI_SERVICE_URL = (process.env.AI_SERVICE_URL ?? "http://localhost:8000").replace(
  /\/$/,
  "",
);
const AI_SERVICE_TOKEN = process.env.AI_SERVICE_TOKEN ?? "";
const AI_MODEL_NAME = process.env.AI_MODEL_NAME ?? "google/siglip-base-patch16-224";
const VECTOR_DIMENSION = Number.parseInt(process.env.VECTOR_DIMENSION ?? "768", 10);
const TIMEOUT_MS = Number.parseInt(process.env.AI_SERVICE_TIMEOUT_MS ?? "60000", 10);

/**
 * Sisipkan transformasi Cloudinary sebelum path versi (`/upload/` →
 * `/upload/w_384,c_fit,f_jpg/`). URL non-Cloudinary dibiarkan apa adanya.
 */
function cloudinaryFit(url: string): string {
  if (!url.includes("res.cloudinary.com") || !url.includes("/upload/")) return url;
  if (/\/upload\/[^/]*(w_|c_|f_)/.test(url)) return url; // sudah ada transform
  return url.replace("/upload/", "/upload/w_384,c_fit,f_jpg/");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── HTTP ke ai-service ───────────────────────────────────────────
async function callEmbed(images: string[]): Promise<EmbedResponse> {
  const res = await fetch(`${AI_SERVICE_URL}/embed`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(AI_SERVICE_TOKEN ? { Authorization: `Bearer ${AI_SERVICE_TOKEN}` } : {}),
    },
    body: JSON.stringify({ images }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      detail = (JSON.parse(text) as { detail?: string }).detail ?? text;
    } catch {
      /* biarkan raw text */
    }
    throw new Error(`ai-service HTTP ${res.status}: ${detail}`);
  }
  const parsed = JSON.parse(text) as EmbedResponse | { data: EmbedResponse };
  return "data" in parsed ? parsed.data : parsed;
}

/** Retry dengan backoff — cold start container model bisa >30s. */
async function embedWithRetry(images: string[]): Promise<EmbedResponse> {
  const delays = [0, 3000, 8000];
  let lastErr: Error | null = null;
  for (const delay of delays) {
    if (delay > 0) await sleep(delay);
    try {
      return await callEmbed(images);
    } catch (err) {
      lastErr = err as Error;
      console.warn(`  ! percobaan gagal: ${lastErr.message}`);
    }
  }
  throw lastErr ?? new Error("embed gagal tanpa detail");
}

// ─── Resolusi company ─────────────────────────────────────────────
async function resolveCompanyId(needle: string): Promise<string> {
  const company = await prisma.company.findFirst({
    where: {
      OR: [
        { id: needle },
        { slug: needle },
        { name: { contains: needle, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, slug: true },
  });
  if (!company) throw new Error(`Company "${needle}" tidak ditemukan`);
  console.log(`Company: ${company.name} (${company.slug}) → ${company.id}`);
  return company.id;
}

async function fetchPending(
  companyId: string | null,
  take: number,
  expectedModel: string,
): Promise<Row[]> {
  // Semua NILAI dikirim sebagai bound parameter ($1..$n); yang disusun dari
  // kode hanya rangka SQL-nya, bukan input.
  const params: unknown[] = [];
  const where: string[] = [`"deletedAt" IS NULL`, `"imageUrl" IS NOT NULL`];

  if (companyId) {
    params.push(companyId);
    where.push(`"companyId" = $${params.length}`);
  }
  // --force: ulangi semua produk berfoto, apa pun status embedding-nya.
  // Selain itu: pilih yang belum di-embed, fotonya berubah, ATAU dibuat oleh
  // model/preprocessing versi lain (vektor lintas-versi tidak sebanding).
  if (!FORCE) {
    params.push(expectedModel);
    where.push(
      `(embedding IS NULL
         OR "embeddedImageUrl" IS DISTINCT FROM "imageUrl"
         OR "embeddingModel" IS DISTINCT FROM $${params.length})`,
    );
  }
  params.push(take);

  return prisma.$queryRawUnsafe<Row[]>(
    `SELECT id, code, name, "imageUrl", "companyId"
     FROM products
     WHERE ${where.join("\n       AND ")}
     ORDER BY "updatedAt" DESC
     LIMIT $${params.length}`,
    ...params,
  );
}

// ─── Main ─────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(64));
  console.log("Backfill embedding gambar produk");
  console.log("=".repeat(64));
  console.log(`ai-service : ${AI_SERVICE_URL}`);
  console.log(`model      : ${AI_MODEL_NAME}`);
  console.log(`batch      : ${BATCH}${LIMIT ? `, limit ${LIMIT}` : ""}`);
  console.log(`mode       : ${DRY_RUN ? "DRY-RUN" : "TULIS"}${FORCE ? " +FORCE" : ""}`);

  // 1) Verifikasi dimensi SEBELUM menulis apa pun. Vektor berdimensi salah
  //    akan ditolak Postgres, tapi lebih baik gagal di sini dengan pesan jelas.
  const healthRes = await fetch(`${AI_SERVICE_URL}/health`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!healthRes.ok) {
    throw new Error(`/health HTTP ${healthRes.status} — ai-service belum siap`);
  }
  const health = (await healthRes.json()) as { model: string; dim: number };
  console.log(`health     : model=${health.model} dim=${health.dim}`);
  if (health.dim !== VECTOR_DIMENSION) {
    throw new Error(
      `Dimensi ai-service (${health.dim}) != VECTOR_DIMENSION (${VECTOR_DIMENSION}). ` +
        `Kolom products.embedding harus dibuat dengan dimensi yang sama.`,
    );
  }

  // 2) Verifikasi kolom sudah ada (migrasi phase58 sudah dijalankan).
  const colDim = await prisma.$queryRawUnsafe<Array<{ dim: number | null }>>(`
    SELECT atttypmod AS dim
    FROM pg_attribute
    WHERE attrelid = 'products'::regclass AND attname = 'embedding'
  `);
  if (colDim.length === 0) {
    throw new Error(
      "Kolom products.embedding belum ada. Jalankan dulu: " +
        "node -r @swc-node/register prisma/apply-phase58.ts",
    );
  }
  console.log(`kolom DB   : vector(${colDim[0].dim})`);

  const companyId = COMPANY ? await resolveCompanyId(COMPANY) : null;

  let totalOk = 0;
  let totalFailed = 0;
  let totalProcessed = 0;
  const failures: Array<{ code: string; name: string; reason: string }> = [];

  for (;;) {
    const remaining = LIMIT > 0 ? LIMIT - totalProcessed : Number.MAX_SAFE_INTEGER;
    if (remaining <= 0) break;
    const take = Math.min(BATCH, remaining);

    const rows = await fetchPending(companyId, take, health.model);
    if (rows.length === 0) break;

    console.log(`\nBatch ${rows.length} produk:`);
    for (const r of rows) console.log(`  - ${r.code} ${r.name}`);

    if (DRY_RUN) {
      totalProcessed += rows.length;
      // Dry-run tidak menulis, jadi query berikutnya mengembalikan baris yang
      // sama → hentikan setelah satu batch supaya tidak loop tak berujung.
      console.log("  (dry-run: tidak menulis, berhenti setelah batch pertama)");
      break;
    }

    let res: EmbedResponse;
    try {
      res = await embedWithRetry(rows.map((r) => cloudinaryFit(r.imageUrl)));
    } catch (err) {
      // Batch gagal total (service mati) → catat lalu STOP; melanjutkan hanya
      // menumpuk kegagalan yang sama.
      console.error(`\nBatch gagal total: ${(err as Error).message}`);
      for (const r of rows) {
        failures.push({ code: r.code, name: r.name, reason: (err as Error).message });
      }
      totalFailed += rows.length;
      break;
    }

    const failedIdx = new Map((res.failed ?? []).map((f) => [f.index, f.reason]));
    const model = res.model || AI_MODEL_NAME;
    let cursor = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const reason = failedIdx.get(i);
      if (reason !== undefined) {
        totalFailed++;
        failures.push({ code: row.code, name: row.name, reason });
        console.log(`  x ${row.code}: ${reason}`);
        continue;
      }
      const vec = res.vectors[cursor++];
      if (!vec || vec.length !== VECTOR_DIMENSION) {
        totalFailed++;
        const why = `vektor tidak valid (panjang ${vec?.length ?? 0})`;
        failures.push({ code: row.code, name: row.name, reason: why });
        console.log(`  x ${row.code}: ${why}`);
        continue;
      }
      try {
        const literal = `[${vec.join(",")}]`;
        await prisma.$executeRaw`
          UPDATE products
          SET embedding = ${literal}::vector,
              "embeddedAt" = NOW(),
              "embeddingModel" = ${model},
              "embeddedImageUrl" = ${row.imageUrl}
          WHERE id = ${row.id}
        `;
        totalOk++;
        console.log(`  v ${row.code}`);
      } catch (err) {
        totalFailed++;
        const why = `gagal simpan: ${(err as Error).message}`;
        failures.push({ code: row.code, name: row.name, reason: why });
        console.log(`  x ${row.code}: ${why}`);
      }
    }
    totalProcessed += rows.length;
  }

  console.log(`\n${"=".repeat(64)}`);
  console.log(`Selesai: ok=${totalOk} gagal=${totalFailed} diproses=${totalProcessed}`);
  if (failures.length > 0) {
    console.log("\nDaftar kegagalan:");
    for (const f of failures) console.log(`  ${f.code} — ${f.name}: ${f.reason}`);
    console.log("\nJalankan ulang perintah yang sama untuk mencoba lagi (resumable).");
  }

  if (!DRY_RUN) {
    const stat = await prisma.$queryRawUnsafe<
      Array<{ with_image: bigint; indexed: bigint }>
    >(
      companyId
        ? `SELECT COUNT(*) FILTER (WHERE "imageUrl" IS NOT NULL)::bigint AS with_image,
                  COUNT(*) FILTER (WHERE embedding IS NOT NULL)::bigint AS indexed
           FROM products WHERE "deletedAt" IS NULL AND "companyId" = $1`
        : `SELECT COUNT(*) FILTER (WHERE "imageUrl" IS NOT NULL)::bigint AS with_image,
                  COUNT(*) FILTER (WHERE embedding IS NOT NULL)::bigint AS indexed
           FROM products WHERE "deletedAt" IS NULL`,
      ...(companyId ? [companyId] : []),
    );
    console.log(
      `Status: ${Number(stat[0].indexed)} / ${Number(stat[0].with_image)} produk berfoto ter-index`,
    );
  }
}

main()
  .catch((err) => {
    console.error(`\nERROR: ${(err as Error).message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });




