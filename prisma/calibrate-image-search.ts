// Kalibrasi gate Search-by-Image dari data nyata.
//
// Jalankan: pnpm db:calibrate:image-search --company=Mondelez [--top=5]
//
// Cara kerja: untuk SETIAP produk yang sudah punya embedding, cari top-N
// tetangga terdekat di company yang sama. Karena query-nya adalah embedding
// produk itu sendiri, tetangga #1 selalu dirinya sendiri (distance 0) — itu
// dipakai sebagai sanity check. Yang menarik adalah distance ke tetangga
// TERDEKAT BERIKUTNYA: itulah batas "produk beda" yang tidak boleh ditembus.
//
// PENTING: gate produksi TIDAK LAGI absolut (IMAGE_SEARCH_MAX_DISTANCE sudah
// dihapus). Yang dipakai adalah rasio ke median jarak per-query, jadi skrip ini
// melaporkan sebaran RASIO tetangga-terdekat-selain-diri — makin kecil rasio
// itu, makin dekat suatu produk katalog "menyamar" jadi produk lain.
// Lihat src/modules/image-search/image-search.gate.ts.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

const COMPANY = arg("company");
const TOP = Math.max(2, Number.parseInt(arg("top") ?? "5", 10) || 5);

type Neighbor = {
  code: string;
  name: string;
  distance: number;
  /** Median jarak anchor ke SELURUH katalog company (sama di semua baris). */
  median: number | null;
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(4) : "-";
}

async function main() {
  console.log("=".repeat(72));
  console.log("Kalibrasi threshold image search");
  console.log("=".repeat(72));

  let companyId: string | null = null;
  if (COMPANY) {
    const company = await prisma.company.findFirst({
      where: {
        OR: [
          { id: COMPANY },
          { slug: COMPANY },
          { name: { contains: COMPANY, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true },
    });
    if (!company) throw new Error(`Company "${COMPANY}" tidak ditemukan`);
    companyId = company.id;
    console.log(`Company: ${company.name} (${company.id})`);
  } else {
    console.log("Company: (semua)");
  }

  const anchors = await prisma.$queryRawUnsafe<
    Array<{ id: string; code: string; name: string; companyId: string }>
  >(
    companyId
      ? `SELECT id, code, name, "companyId" FROM products
         WHERE embedding IS NOT NULL AND "deletedAt" IS NULL AND "companyId" = $1
         ORDER BY code`
      : `SELECT id, code, name, "companyId" FROM products
         WHERE embedding IS NOT NULL AND "deletedAt" IS NULL
         ORDER BY "companyId", code`,
    ...(companyId ? [companyId] : []),
  );

  if (anchors.length === 0) {
    console.log(
      "\nTidak ada produk ber-embedding. Jalankan dulu: pnpm db:backfill:embeddings",
    );
    return;
  }
  console.log(`Produk ber-embedding: ${anchors.length}\n`);

  const selfDistances: number[] = [];
  const nextDistances: number[] = [];
  /** Rasio jarak tetangga-terdekat-selain-diri terhadap median query-nya. */
  const nextRatios: number[] = [];
  const suspicious: Array<{ code: string; name: string; neighbor: Neighbor }> = [];

  for (const a of anchors) {
    // Self-join: bandingkan embedding anchor dengan semua produk di company
    // yang sama. Tidak ada vektor yang dikirim dari luar sama sekali.
    // Median dihitung atas SELURUH katalog (bukan top-N) supaya rasionya
    // sebanding dengan yang dipakai ImageSearchService.
    const neighbors = await prisma.$queryRawUnsafe<Neighbor[]>(
      `WITH anchor AS (SELECT embedding FROM products WHERE id = $1),
       scored AS (
         SELECT p.code, p.name, (p.embedding <=> anchor.embedding) AS distance
         FROM products p
         CROSS JOIN anchor
         WHERE p."companyId" = $2
           AND p."deletedAt" IS NULL
           AND p.embedding IS NOT NULL
       ),
       stats AS (
         SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY distance) AS median
         FROM scored
       )
       SELECT s.code, s.name, s.distance, st.median
       FROM scored s
       CROSS JOIN stats st
       ORDER BY s.distance ASC
       LIMIT $3`,
      a.id,
      a.companyId,
      TOP,
    );

    if (neighbors.length === 0) continue;
    const self = Number(neighbors[0].distance);
    selfDistances.push(self);

    const next = neighbors.find((n) => n.code !== a.code);
    if (next) {
      const d = Number(next.distance);
      nextDistances.push(d);
      const median = next.median === null ? null : Number(next.median);
      if (median !== null && median > 0) nextRatios.push(d / median);
      // Jarak sangat kecil ke produk LAIN = kandidat false positive; berguna
      // untuk memutuskan threshold.
      if (d < 0.1) {
        suspicious.push({
          code: a.code,
          name: a.name,
          neighbor: { code: next.code, name: next.name, distance: d, median },
        });
      }
    }

    console.log(`${a.code} — ${a.name}`);
    for (const n of neighbors) {
      const mark = n.code === a.code ? "self" : "    ";
      console.log(`   ${mark} ${fmt(Number(n.distance))}  ${n.code} ${n.name}`);
    }
  }

  const sortedSelf = [...selfDistances].sort((x, y) => x - y);
  const sortedNext = [...nextDistances].sort((x, y) => x - y);

  console.log(`\n${"=".repeat(72)}`);
  console.log("RINGKASAN");
  console.log("=".repeat(72));
  console.log(
    `Self-distance (harus ~0): min=${fmt(sortedSelf[0])} ` +
      `max=${fmt(sortedSelf[sortedSelf.length - 1])}`,
  );
  if (sortedSelf[sortedSelf.length - 1] > 1e-4) {
    console.log(
      "  ! Self-distance tidak nol — vektor tidak deterministik atau kolom salah.",
    );
  }

  console.log("\nJarak ke produk LAIN yang paling dekat:");
  console.log(`  n     = ${sortedNext.length}`);
  console.log(`  min   = ${fmt(sortedNext[0])}`);
  console.log(`  p05   = ${fmt(percentile(sortedNext, 5))}`);
  console.log(`  p25   = ${fmt(percentile(sortedNext, 25))}`);
  console.log(`  median= ${fmt(percentile(sortedNext, 50))}`);
  console.log(`  p75   = ${fmt(percentile(sortedNext, 75))}`);
  console.log(`  max   = ${fmt(sortedNext[sortedNext.length - 1])}`);

  if (suspicious.length > 0) {
    console.log(
      `\nPasangan sangat mirip (<0.10) — ${suspicious.length} kasus. Ini varian` +
        " kemasan/rasa yang memang mirip, atau foto duplikat:",
    );
    for (const s of suspicious.slice(0, 20)) {
      console.log(
        `  ${s.code} ${s.name}  ~  ${s.neighbor.code} ${s.neighbor.name} ` +
          `(${fmt(s.neighbor.distance)})`,
      );
    }
  }

  // Rasio inilah yang menentukan gate produksi. Tetangga TERDEKAT SELAIN DIRI
  // adalah kasus terburuk "produk beda yang paling mirip": rasio terkecil di
  // katalog = batas bawah yang boleh dilewati IMAGE_SEARCH_RATIO_MAX.
  const sortedRatio = [...nextRatios].sort((x, y) => x - y);
  console.log("\nRASIO ke produk LAIN terdekat (distance / median query):");
  console.log(`  n     = ${sortedRatio.length}`);
  console.log(`  min   = ${fmt(sortedRatio[0])}`);
  console.log(`  p05   = ${fmt(percentile(sortedRatio, 5))}`);
  console.log(`  median= ${fmt(percentile(sortedRatio, 50))}`);

  console.log(
    `\nIMAGE_SEARCH_RATIO_MAX aktif = ${process.env.IMAGE_SEARCH_RATIO_MAX ?? "(default 0.60)"}`,
  );
  console.log(
    "Cara membaca: rasio di atas berasal dari FOTO KATALOG vs FOTO KATALOG,\n" +
      "jadi nilai kecil di sini berarti ada pasangan produk yang memang mirip\n" +
      "(varian ukuran/rasa atau foto duplikat) — bukan otomatis berarti gate\n" +
      "harus diturunkan. Yang menentukan batas atas gate adalah foto NYATA dari\n" +
      "kamera: produk yang benar terukur pada rasio 0.185–0.466, sementara foto\n" +
      "produk yang TIDAK ADA di katalog jatuh di 0.732–0.876.\n" +
      "Kunci angkanya di src/modules/image-search/image-search.gate.spec.ts.",
  );
}

main()
  .catch((err) => {
    console.error(`\nERROR: ${(err as Error).message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

