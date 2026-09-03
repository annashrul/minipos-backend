import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { EmbeddingClient } from "@/common/embedding/embedding.client";
import { ProductEmbeddingService } from "./product-embedding.service";

/**
 * Jaring pengaman untuk embedding yang belum jadi: produk yang dibuat saat
 * ai-service mati, atau yang fire-and-forget-nya gagal. Sejak `findPending`
 * juga memilih baris yang `embeddingModel`-nya berbeda dari model+preprocessing
 * aktif, sweeper ini SEKALIGUS menjadi jalur migrasi otomatis saat pipeline
 * embedding dinaikkan versinya — tidak ada langkah manual yang wajib.
 * Pola @Cron mengikuti marketplace-grab-cron.service.ts; ScheduleModule.forRoot()
 * sudah aktif di app.module.ts, jadi tidak ada dependency queue baru.
 */
@Injectable()
export class EmbeddingSweeperService {
  private readonly logger = new Logger(EmbeddingSweeperService.name);
  private running = false;

  constructor(
    private readonly embeddings: ProductEmbeddingService,
    private readonly client: EmbeddingClient,
  ) {}

  private get batchSize(): number {
    const n = Number.parseInt(process.env.EMBEDDING_SWEEP_BATCH ?? "", 10);
    return Number.isFinite(n) && n > 0 ? n : 16;
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async sweep(): Promise<void> {
    if (process.env.EMBEDDING_SWEEP_ENABLED === "false") return;
    if (!this.client.configured) return;
    // Guard reentrancy: batch bisa lebih lama dari interval saat cold start.
    if (this.running) {
      this.logger.warn("sweep sebelumnya masih jalan — dilewati");
      return;
    }
    this.running = true;
    try {
      const rows = await this.embeddings.findPending(this.batchSize);
      if (rows.length === 0) return;
      this.logger.log(`sweep: ${rows.length} produk perlu di-embed`);
      const res = await this.embeddings.embedBatch(rows);
      this.logger.log(
        `sweep selesai: ok=${res.ok} gagal=${res.failed}` +
          (res.failures.length > 0
            ? ` (contoh: ${res.failures[0].code} — ${res.failures[0].reason})`
            : ""),
      );
    } catch (err) {
      this.logger.error(`sweep error: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
