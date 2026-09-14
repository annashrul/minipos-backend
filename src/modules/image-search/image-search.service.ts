import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { EmbeddingClient } from "@/common/embedding/embedding.client";
import { PrismaService } from "@/modules/prisma/prisma.service";
import type {
  ImageSearchHit,
  ImageSearchQueryDto,
  ImageSearchResponse,
  ImageSearchStatusResponse,
  ImageSearchTextQueryDto,
} from "./dto/image-search.dto";
import {
  DEFAULT_ABS_FLOOR,
  DEFAULT_ABS_MAX,
  DEFAULT_LIMIT,
  DEFAULT_NEAR_LIMIT,
  DEFAULT_RATIO_MAX,
  DEFAULT_TEXT_ABS_MAX,
  DEFAULT_TEXT_LIMIT,
  isNearMiss,
  isTextMatch,
  ratioOf,
  resolveGate,
} from "./image-search.gate";

type RawHit = {
  id: string;
  code: string;
  name: string;
  imageUrl: string | null;
  categoryName: string | null;
  sellingPrice: number | null;
  stock: number | null;
  unit: string | null;
  distance: number;
  /** Median jarak SELURUH katalog company (sama di semua baris). */
  median: number | null;
  /** Jumlah baris yang diukur (sama di semua baris). */
  sample: bigint | number;
};

@Injectable()
export class ImageSearchService {
  private readonly logger = new Logger(ImageSearchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingClient,
  ) {}

  private get envLimit(): number {
    const n = Number.parseInt(process.env.IMAGE_SEARCH_LIMIT ?? "", 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_LIMIT;
  }

  private envNumber(name: string, fallback: number): number {
    const n = Number.parseFloat(process.env[name] ?? "");
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  /**
   * Jumlah kandidat "serupa" saat tidak ada hit yang lolos gate. Berbeda dari
   * `envNumber`: 0 adalah nilai SAH (mematikan tier serupa), jadi tidak boleh
   * jatuh ke fallback.
   */
  private get nearLimit(): number {
    const n = Number.parseInt(process.env.IMAGE_SEARCH_NEAR_LIMIT ?? "", 10);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_NEAR_LIMIT;
  }

  private get textLimit(): number {
    const n = Number.parseInt(process.env.IMAGE_SEARCH_TEXT_LIMIT ?? "", 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_TEXT_LIMIT;
  }

  private get maxImageBytes(): number {
    const mb = Number.parseFloat(process.env.IMAGE_MAX_SIZE_MB ?? "");
    return (Number.isFinite(mb) && mb > 0 ? mb : 5) * 1024 * 1024;
  }

  /** Embed gambar query langsung ke ai-service tanpa cache eksternal. */
  private async embedQuery(image: string): Promise<number[]> {
    // Perkiraan ukuran byte dari panjang base64 (4 char ≈ 3 byte).
    const base64 = image.includes(",") ? image.slice(image.indexOf(",") + 1) : image;
    if (base64.length * 0.75 > this.maxImageBytes) {
      throw new BadRequestException(
        `Ukuran gambar melebihi ${process.env.IMAGE_MAX_SIZE_MB ?? 5}MB`,
      );
    }

    const health = await this.embedding.health();
    if (health.model !== this.embedding.modelName) {
      throw new Error(
        `ai-service memakai model ${health.model}, backend mengharapkan ${this.embedding.modelName}`,
      );
    }

    return this.embedding.embedOne(image);
  }

  /** Embed teks query langsung ke ai-service tanpa cache eksternal. */
  private async embedTextQuery(text: string): Promise<number[]> {
    return this.embedding.embedTextOne(text.trim());
  }

  /** Jumlah produk yang sudah punya embedding di company ini. */
  private async countIndexed(companyId: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n
      FROM products
      WHERE "companyId" = ${companyId}
        AND "deletedAt" IS NULL
        AND embedding IS NOT NULL
    `;
    return Number(rows[0]?.n ?? 0);
  }

  // ─── Pencarian utama ───────────────────────────────────────────
  async search(
    companyId: string,
    dto: ImageSearchQueryDto,
  ): Promise<ImageSearchResponse> {
    const limit = dto.limit ?? this.envLimit;
    const ratioMax =
      dto.maxRatio ?? this.envNumber("IMAGE_SEARCH_RATIO_MAX", DEFAULT_RATIO_MAX);
    const absMax =
      dto.maxDistance ?? this.envNumber("IMAGE_SEARCH_ABS_MAX", DEFAULT_ABS_MAX);
    const absFloor = Math.min(
      absMax,
      this.envNumber("IMAGE_SEARCH_ABS_FLOOR", DEFAULT_ABS_FLOOR),
    );
    const model = this.embedding.modelName;

    if (!this.embedding.configured) {
      return {
        hits: [],
        near: [],
        indexed: 0,
        model,
        warning:
          "Pencarian vektor belum aktif: AI_SERVICE_URL belum di-set di backend.",
      };
    }

    const indexed = await this.countIndexed(companyId);
    if (indexed === 0) {
      return {
        hits: [],
        near: [],
        indexed: 0,
        model,
        warning:
          "Belum ada produk yang di-index. Jalankan backfill embedding dulu " +
          "(pnpm db:backfill:embeddings).",
      };
    }

    let vec: number[];
    try {
      vec = await this.embedQuery(dto.image);
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      return {
        hits: [],
        near: [],
        indexed,
        model,
        warning: `Gagal memproses gambar: ${(err as Error).message}`,
      };
    }

    const literal = EmbeddingClient.toVectorLiteral(vec);

    // Exact scan (tanpa index ANN) — pre-filter companyId membuat kandidat
    // hanya puluhan baris, recall 100%. Vektor dikirim sebagai BOUND PARAM
    // lalu di-cast ::vector; tidak ada interpolasi string ke SQL.
    //
    // CTE `scored` menghitung jarak SEKALI untuk seluruh katalog company, lalu:
    //   * `stats`  → median + jumlah baris, dasar uji rasio (lihat
    //     image-search.gate.ts). Median WAJIB dari seluruh katalog, bukan dari
    //     top-N: median atas tetangga terdekat saja akan condong kecil dan
    //     merusak kalibrasi.
    //   * SELECT luar → hanya `limit` baris teratas yang di-join ke kolom
    //     lengkap, jadi payload tetap kecil walau median dihitung menyeluruh.
    // Penyaringan gate dilakukan di TypeScript (bukan di WHERE) karena butuh
    // median; karena baris sudah urut menaik, memfilter top-`limit` identik
    // dengan memfilter-lalu-memotong.
    const rows = await this.prisma.$queryRaw<RawHit[]>`
      WITH scored AS (
        SELECT p.id,
               (p.embedding <=> ${literal}::vector) AS distance
        FROM products p
        WHERE p."companyId" = ${companyId}
          AND p."deletedAt" IS NULL
          AND p."isActive" = true
          AND p.embedding IS NOT NULL
      ),
      stats AS (
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY distance) AS median,
               COUNT(*)::bigint AS sample
        FROM scored
      )
      SELECT p.id,
             p.code,
             p.name,
             p."imageUrl",
             c.name AS "categoryName",
             p."sellingPrice",
             p.stock,
             p.unit,
             s.distance,
             st.median,
             st.sample
      FROM scored s
      JOIN products p ON p.id = s.id
      LEFT JOIN categories c ON c.id = p."categoryId"
      CROSS JOIN stats st
      ORDER BY s.distance ASC
      LIMIT ${limit}
    `;

    const first: RawHit | undefined = rows[0];
    const rawMedian = first?.median ?? null;
    const median =
      rawMedian !== null && Number.isFinite(Number(rawMedian))
        ? Number(rawMedian)
        : null;
    const sampleSize = Number(first?.sample ?? 0);
    const { gate, basis } = resolveGate({
      median,
      sampleSize,
      ratioMax,
      absMax,
      absFloor,
    });

    // Baris di-map SEKALI, lalu dibagi dua tier. `rows` sudah urut menaik.
    const scored: ImageSearchHit[] = rows.map((r) => {
      const distance = Number(r.distance);
      return {
        id: r.id,
        code: r.code,
        name: r.name,
        imageUrl: r.imageUrl,
        categoryName: r.categoryName,
        sellingPrice: Number(r.sellingPrice ?? 0),
        stock: Number(r.stock ?? 0),
        unit: r.unit ?? "pcs",
        distance,
        similarity: Math.max(0, Math.min(1, 1 - distance)),
        ratio: ratioOf(distance, median),
      };
    });

    const hits = scored.filter((h) => h.distance <= gate);
    // Tier "serupa" HANYA saat tidak ada yang lolos gate: kalau sudah ada hit
    // yang benar, menambah tetangga asing justru mengencerkan hasil. Ini yang
    // mencegah query kategori (botol air mineral tanpa label vs `aqua gelas`)
    // berujung "tidak ada di katalog" padahal tetangga terdekatnya relevan.
    const near =
      hits.length > 0
        ? []
        : scored
            .filter((h) => isNearMiss(h.distance, gate))
            .slice(0, this.nearLimit);

    if (hits.length === 0 && rows.length > 0) {
      // Bukan error: berarti tidak ada yang cukup menonjol. Di-log supaya
      // kalibrasi bisa ditinjau dari kejadian nyata, bukan hanya dari dataset uji.
      this.logger.log(
        `tidak ada hit: terdekat d=${Number(rows[0].distance).toFixed(4)} ` +
          `median=${median?.toFixed(4) ?? "-"} gate=${gate.toFixed(4)} (${basis}) ` +
          `→ ${near.length} kandidat serupa`,
      );
    }

    return {
      hits,
      near,
      indexed,
      model,
      stats: { median, sampleSize, gate, basis },
    };
  }

  // ─── Pencarian dari DESKRIPSI TEKS ─────────────────────────────
  /**
   * Cocokkan deskripsi teks ke FOTO produk lewat text tower SigLIP.
   *
   * Jaring terakhir Search-by-Image: dipakai dengan deskripsi yang dibaca LLM
   * vision ketika jalur gambar↔gambar tidak menemukan apa pun. Ambangnya
   * ABSOLUT dan berbeda dari jalur gambar — lihat DEFAULT_TEXT_ABS_MAX.
   */
  async searchByText(
    companyId: string,
    dto: ImageSearchTextQueryDto,
  ): Promise<ImageSearchResponse> {
    const limit = dto.limit ?? this.textLimit;
    const absMax =
      dto.maxDistance ??
      this.envNumber("IMAGE_SEARCH_TEXT_ABS_MAX", DEFAULT_TEXT_ABS_MAX);
    const model = this.embedding.modelName;

    if (!this.embedding.configured) {
      return {
        hits: [],
        near: [],
        indexed: 0,
        model,
        warning:
          "Pencarian vektor belum aktif: AI_SERVICE_URL belum di-set di backend.",
      };
    }

    const indexed = await this.countIndexed(companyId);
    if (indexed === 0) {
      return {
        hits: [],
        near: [],
        indexed: 0,
        model,
        warning:
          "Belum ada produk yang di-index. Jalankan backfill embedding dulu " +
          "(pnpm db:backfill:embeddings).",
      };
    }

    let vec: number[];
    try {
      vec = await this.embedTextQuery(dto.text);
    } catch (err) {
      return {
        hits: [],
        near: [],
        indexed,
        model,
        warning: `Gagal memproses teks: ${(err as Error).message}`,
      };
    }

    const literal = EmbeddingClient.toVectorLiteral(vec);
    const rows = await this.prisma.$queryRaw<RawHit[]>`
      WITH scored AS (
        SELECT p.id,
               (p.embedding <=> ${literal}::vector) AS distance
        FROM products p
        WHERE p."companyId" = ${companyId}
          AND p."deletedAt" IS NULL
          AND p."isActive" = true
          AND p.embedding IS NOT NULL
      ),
      stats AS (
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY distance) AS median,
               COUNT(*)::bigint AS sample
        FROM scored
      )
      SELECT p.id,
             p.code,
             p.name,
             p."imageUrl",
             c.name AS "categoryName",
             p."sellingPrice",
             p.stock,
             p.unit,
             s.distance,
             st.median,
             st.sample
      FROM scored s
      JOIN products p ON p.id = s.id
      LEFT JOIN categories c ON c.id = p."categoryId"
      CROSS JOIN stats st
      ORDER BY s.distance ASC
      LIMIT ${limit}
    `;

    const first: RawHit | undefined = rows[0];
    const rawMedian = first?.median ?? null;
    // Median hanya informasi untuk debugging di jalur ini: uji rasio TIDAK
    // dipakai karena sebaran teks↔gambar tumpang tindih (lihat gate).
    const median =
      rawMedian !== null && Number.isFinite(Number(rawMedian))
        ? Number(rawMedian)
        : null;
    const sampleSize = Number(first?.sample ?? 0);

    const hits: ImageSearchHit[] = rows
      .map((r) => {
        const distance = Number(r.distance);
        return {
          id: r.id,
          code: r.code,
          name: r.name,
          imageUrl: r.imageUrl,
          categoryName: r.categoryName,
          sellingPrice: Number(r.sellingPrice ?? 0),
          stock: Number(r.stock ?? 0),
          unit: r.unit ?? "pcs",
          distance,
          similarity: Math.max(0, Math.min(1, 1 - distance)),
          ratio: ratioOf(distance, median),
        };
      })
      .filter((h) => isTextMatch(h.distance, absMax));

    if (hits.length === 0 && rows.length > 0) {
      this.logger.log(
        `teks "${dto.text}" tanpa hit: terdekat d=${Number(rows[0].distance).toFixed(4)} ` +
          `ambang=${absMax.toFixed(4)}`,
      );
    }

    return {
      hits,
      near: [],
      indexed,
      model,
      stats: { median, sampleSize, gate: absMax, basis: "text-abs" },
    };
  }

  // ─── Status kesiapan index ─────────────────────────────────────
  async status(companyId: string): Promise<ImageSearchStatusResponse> {
    // Stale = foto berubah SETELAH di-embed ATAU dibuat oleh model/preprocessing
    // versi lain. Keduanya harus di-embed ulang; vektor dari pipeline berbeda
    // tidak sebanding dengan vektor query.
    const model = this.embedding.modelName;
    const rows = await this.prisma.$queryRaw<
      Array<{
        total: bigint;
        with_image: bigint;
        indexed: bigint;
        stale: bigint;
      }>
    >`
      SELECT COUNT(*)::bigint AS total,
             COUNT(*) FILTER (WHERE "imageUrl" IS NOT NULL)::bigint AS with_image,
             COUNT(*) FILTER (WHERE embedding IS NOT NULL)::bigint AS indexed,
             COUNT(*) FILTER (
               WHERE embedding IS NOT NULL
                 AND (
                   "embeddedImageUrl" IS DISTINCT FROM "imageUrl"
                   OR "embeddingModel" IS DISTINCT FROM ${model}
                 )
             )::bigint AS stale
      FROM products
      WHERE "companyId" = ${companyId}
        AND "deletedAt" IS NULL
        AND "isActive" = true
    `;
    const r = rows[0];
    const total = Number(r?.total ?? 0);
    const withImage = Number(r?.with_image ?? 0);
    const indexed = Number(r?.indexed ?? 0);
    const staleCount = Number(r?.stale ?? 0);

    const modelRows = await this.prisma.$queryRaw<
      Array<{ model: string | null }>
    >`
      SELECT "embeddingModel" AS model
      FROM products
      WHERE "companyId" = ${companyId} AND "embeddingModel" IS NOT NULL
      LIMIT 1
    `;

    let serviceReachable = false;
    if (this.embedding.configured) {
      try {
        await this.embedding.health();
        serviceReachable = true;
      } catch (err) {
        this.logger.warn(`ai-service tidak reachable: ${(err as Error).message}`);
      }
    }

    return {
      totalProducts: total,
      withImage,
      indexed,
      pending: Math.max(0, withImage - indexed) + staleCount,
      staleCount,
      model: modelRows[0]?.model ?? null,
      serviceReachable,
      ready: indexed > 0 && serviceReachable,
    };
  }
}

