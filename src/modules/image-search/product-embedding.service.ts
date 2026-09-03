import { Injectable, Logger } from "@nestjs/common";
import { EmbeddingClient } from "@/common/embedding/embedding.client";
import { PrismaService } from "@/modules/prisma/prisma.service";

export type EmbedProductResult =
  | { status: "ok"; model: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

export type BackfillProgress = {
  processed: number;
  ok: number;
  failed: number;
  failures: Array<{ id: string; code: string; reason: string }>;
};

/**
 * Menulis embedding gambar ke products.embedding.
 *
 * Kolom `embedding` bertipe Unsupported("vector(768)") di schema.prisma →
 * TIDAK bisa disentuh Prisma Client. Semua tulis/baca lewat $executeRaw /
 * $queryRaw dengan bound parameter (vektor dikirim sebagai string lalu
 * di-cast ::vector — bukan interpolasi SQL).
 */
@Injectable()
export class ProductEmbeddingService {
  private readonly logger = new Logger(ProductEmbeddingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingClient,
  ) {}

  /** Kosongkan embedding — dipakai saat imageUrl dihapus/berubah. */
  async clear(productId: string): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE products
      SET embedding = NULL,
          "embeddedAt" = NULL,
          "embeddingModel" = NULL,
          "embeddedImageUrl" = NULL
      WHERE id = ${productId}
    `;
  }

  /**
   * Embed satu produk dari imageUrl-nya lalu simpan. Tidak melempar —
   * mengembalikan status supaya caller (create/update produk) bisa lanjut
   * meski embedding gagal.
   */
  async embedProduct(
    productId: string,
    imageUrl: string | null,
  ): Promise<EmbedProductResult> {
    if (!imageUrl) {
      await this.clear(productId);
      return { status: "skipped", reason: "produk tidak punya imageUrl" };
    }
    if (!this.embedding.configured) {
      return { status: "skipped", reason: "AI_SERVICE_URL belum di-set" };
    }

    // Hemat panggilan model: kalau embedding untuk URL ini sudah ada DAN dibuat
    // oleh model/preprocessing yang sama, tidak perlu embed ulang. Query PK, murah.
    const current = await this.prisma.$queryRaw<
      Array<{
        has_embedding: boolean;
        embeddedImageUrl: string | null;
        embeddingModel: string | null;
      }>
    >`
      SELECT (embedding IS NOT NULL) AS has_embedding,
             "embeddedImageUrl",
             "embeddingModel"
      FROM products
      WHERE id = ${productId}
    `;
    const row = current[0];
    if (
      row?.has_embedding &&
      row.embeddedImageUrl === imageUrl &&
      row.embeddingModel === this.embedding.modelName
    ) {
      return { status: "skipped", reason: "embedding sudah sesuai imageUrl" };
    }

    try {
      const vec = await this.embedding.embedOne(imageUrl);
      const literal = EmbeddingClient.toVectorLiteral(vec);
      const model = this.embedding.modelName;
      await this.prisma.$executeRaw`
        UPDATE products
        SET embedding = ${literal}::vector,
            "embeddedAt" = NOW(),
            "embeddingModel" = ${model},
            "embeddedImageUrl" = ${imageUrl}
        WHERE id = ${productId}
      `;
      return { status: "ok", model };
    } catch (err) {
      const reason = (err as Error).message;
      this.logger.warn(`embed produk ${productId} gagal: ${reason}`);
      return { status: "failed", reason };
    }
  }


  /**
   * Hook untuk create/update produk. Fire-and-forget: DIPANGGIL TANPA await
   * di jalur request supaya user tidak menunggu model, dan kegagalan
   * embedding TIDAK PERNAH menggagalkan penyimpanan produk.
   */
  syncInBackground(productId: string, imageUrl: string | null): void {
    void this.embedProduct(productId, imageUrl)
      .then((res) => {
        if (res.status === "ok") {
          this.logger.log(`embedding produk ${productId} tersimpan`);
        }
      })
      .catch((err) => {
        this.logger.warn(
          `embedding produk ${productId} error tak terduga: ${(err as Error).message}`,
        );
      });
  }

  // ─── Batch / backfill ───────────────────────────────────────────
  /**
   * Produk yang perlu di-embed: belum punya embedding, imageUrl-nya sudah
   * berbeda dari yang dipakai saat embedding dibuat (stale), ATAU embedding-nya
   * dibuat oleh model/preprocessing versi lain (`embeddingModel` != modelName).
   * Yang terakhir membuat perubahan pipeline otomatis ter-backfill oleh sweeper
   * tanpa perlu perintah manual.
   * Query ini yang memanfaatkan idx_products_embed_pending.
   */
  async findPending(
    limit: number,
    companyId?: string,
  ): Promise<Array<{ id: string; code: string; name: string; imageUrl: string }>> {
    const model = this.embedding.modelName;
    if (companyId) {
      return this.prisma.$queryRaw<
        Array<{ id: string; code: string; name: string; imageUrl: string }>
      >`
        SELECT id, code, name, "imageUrl"
        FROM products
        WHERE "companyId" = ${companyId}
          AND "deletedAt" IS NULL
          AND "imageUrl" IS NOT NULL
          AND (
            embedding IS NULL
            OR "embeddedImageUrl" IS DISTINCT FROM "imageUrl"
            OR "embeddingModel" IS DISTINCT FROM ${model}
          )
        ORDER BY "updatedAt" DESC
        LIMIT ${limit}
      `;
    }
    return this.prisma.$queryRaw<
      Array<{ id: string; code: string; name: string; imageUrl: string }>
    >`
      SELECT id, code, name, "imageUrl"
      FROM products
      WHERE "deletedAt" IS NULL
        AND "imageUrl" IS NOT NULL
        AND (
          embedding IS NULL
          OR "embeddedImageUrl" IS DISTINCT FROM "imageUrl"
          OR "embeddingModel" IS DISTINCT FROM ${model}
        )
      ORDER BY "updatedAt" DESC
      LIMIT ${limit}
    `;
  }

  /**
   * Embed satu batch sekaligus (1 request ke ai-service untuk N gambar),
   * lalu simpan per produk. Vektor yang gagal dicatat, tidak menghentikan
   * batch. Resumable: produk yang gagal tetap `embedding IS NULL` sehingga
   * ikut terambil di run berikutnya.
   */
  async embedBatch(
    rows: Array<{ id: string; code: string; imageUrl: string }>,
  ): Promise<BackfillProgress> {
    const progress: BackfillProgress = {
      processed: rows.length,
      ok: 0,
      failed: 0,
      failures: [],
    };
    if (rows.length === 0) return progress;

    let result: Awaited<ReturnType<EmbeddingClient["embed"]>>;
    try {
      result = await this.embedding.embed(rows.map((r) => r.imageUrl));
    } catch (err) {
      // Seluruh batch gagal (service mati / timeout / dim mismatch).
      progress.failed = rows.length;
      progress.failures = rows.map((r) => ({
        id: r.id,
        code: r.code,
        reason: (err as Error).message,
      }));
      return progress;
    }

    const failedIdx = new Map(result.failed.map((f) => [f.index, f.reason]));
    const model = result.model || this.embedding.modelName;
    // ai-service mengembalikan `vectors` hanya untuk input yang SUKSES,
    // urut sesuai input setelah yang gagal dilewati.
    let cursor = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const reason = failedIdx.get(i);
      if (reason !== undefined) {
        progress.failed++;
        progress.failures.push({ id: row.id, code: row.code, reason });
        continue;
      }
      const vec = result.vectors[cursor++];
      if (!vec) {
        progress.failed++;
        progress.failures.push({
          id: row.id,
          code: row.code,
          reason: "ai-service tidak mengembalikan vektor untuk input ini",
        });
        continue;
      }
      try {
        const literal = EmbeddingClient.toVectorLiteral(vec);
        await this.prisma.$executeRaw`
          UPDATE products
          SET embedding = ${literal}::vector,
              "embeddedAt" = NOW(),
              "embeddingModel" = ${model},
              "embeddedImageUrl" = ${row.imageUrl}
          WHERE id = ${row.id}
        `;
        progress.ok++;
      } catch (err) {
        progress.failed++;
        progress.failures.push({
          id: row.id,
          code: row.code,
          reason: `gagal simpan: ${(err as Error).message}`,
        });
      }
    }
    return progress;
  }
}

