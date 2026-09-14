import { Injectable, Logger } from "@nestjs/common";
import type {
  EmbedInput,
  EmbedResult,
  EmbedTextInput,
  EmbeddingHealth,
} from "./embedding.types";

/**
 * Tag preprocessing gambar yang HARUS sama dengan PREPROCESS_TAG di
 * `ai-service/main.py`. Preprocessing ikut menentukan nilai vektor, jadi tag
 * ini bagian dari identitas embedding: `modelName` = "<model>+<tag>", disimpan
 * di products."embeddingModel". Baris dengan tag lain dianggap stale dan
 * di-embed ulang oleh backfill/sweeper.
 *
 * Sengaja konstanta kode (bukan env): nilainya menggambarkan KODE yang jalan,
 * dan env yang salah-set hanya akan membuat vektor tidak sebanding secara
 * senyap. Naikkan bersamaan dengan ai-service saat pipeline berubah.
 */
export const EMBEDDING_PREPROCESS_TAG = "tp3";

// Thin HTTP client untuk ai-service (FastAPI + SigLIP/CLIP).
// Pola mengikuti WaServiceClient: global fetch (Node 20), tanpa axios,
// unwrap envelope { data }, lempar Error & { status }.
//
// KEAMANAN: ai-service TIDAK boleh terekspos publik. Kalau AI_SERVICE_TOKEN
// diset, dikirim sebagai Bearer dan FastAPI wajib memvalidasinya. Di Render
// service ini dideploy sebagai private service (bukan type: web).
@Injectable()
export class EmbeddingClient {
  private readonly logger = new Logger(EmbeddingClient.name);

  /** Dimensi + model hasil introspeksi /health. Di-cache setelah sukses. */
  private cachedHealth: EmbeddingHealth | null = null;

  get configured(): boolean {
    return Boolean(process.env.AI_SERVICE_URL);
  }

  get baseUrl(): string {
    const url = process.env.AI_SERVICE_URL;
    if (!url) {
      throw new Error("AI_SERVICE_URL belum di-set di environment backend");
    }
    return url.replace(/\/$/, "");
  }

  /** Dimensi yang DIHARAPKAN dari env. Sumber kebenaran = /health.dim. */
  get expectedDimension(): number {
    const raw = process.env.VECTOR_DIMENSION;
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 768;
  }

  get modelName(): string {
    const base = process.env.AI_MODEL_NAME ?? "google/siglip-base-patch16-224";
    return `${base}+${EMBEDDING_PREPROCESS_TAG}`;
  }

  private get timeoutMs(): number {
    const raw = process.env.AI_SERVICE_TIMEOUT_MS;
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 20_000;
  }

  private headers(withBody: boolean): Record<string, string> {
    const token = process.env.AI_SERVICE_TOKEN;
    return {
      ...(withBody ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  // ─── Low-level request ──────────────────────────────────────────
  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    // AbortSignal.timeout tersedia di Node 18+. Tanpa ini request bisa
    // menggantung selama cold start container model.
    const signal = AbortSignal.timeout(this.timeoutMs);

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: this.headers(body !== undefined),
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
      });
    } catch (err) {
      const name = (err as Error).name;
      const msg =
        name === "TimeoutError" || name === "AbortError"
          ? `ai-service timeout (${this.timeoutMs}ms) pada ${method} ${path}`
          : `ai-service tidak dapat dihubungi pada ${method} ${path}: ${(err as Error).message}`;
      this.logger.warn(msg);
      const wrapped = new Error(msg) as Error & { status?: number };
      wrapped.status = 503;
      throw wrapped;
    }

    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      const msg =
        (parsed as { detail?: string } | null)?.detail ??
        (parsed as { message?: string } | null)?.message ??
        `ai-service HTTP ${res.status} pada ${method} ${path}`;
      this.logger.warn(`${method} ${path} → ${res.status}: ${msg}`);
      const err = new Error(msg) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }

    const data =
      (parsed as { data?: T } | null)?.data !== undefined
        ? (parsed as { data: T }).data
        : (parsed as T);
    return data;
  }

  // ─── Health / introspeksi dimensi ──────────────────────────────
  async health(): Promise<EmbeddingHealth> {
    const h = await this.request<EmbeddingHealth>("GET", "/health");
    this.cachedHealth = h;
    return h;
  }

  /**
   * Cek apakah AI service memang hidup dan menjawab /health.
   * Dipakai untuk health check aplikasi agar downtime model terlihat jelas.
   */
  async isReachable(): Promise<boolean> {
    if (!this.configured) {
      return false;
    }

    try {
      const health = await this.health();
      return health?.status === "ok" && Number.isFinite(health.dim) && health.dim > 0;
    } catch {
      return false;
    }
  }

  /**
   * Pastikan dimensi model == VECTOR_DIMENSION == kolom DB. Mismatch berarti
   * vektor yang disimpan tidak akan pernah comparable → gagal cepat, jangan
   * simpan sampah. Hasil di-cache supaya tidak nge-hit /health tiap request.
   *
   * Beda `model` (nama + tag preprocessing) TIDAK dianggap fatal: vektor tetap
   * berdimensi benar dan hanya perlu di-embed ulang — itu tugas sweeper/backfill
   * yang menandai baris ber-`embeddingModel` lain sebagai stale. Cukup WARNING
   * supaya deploy backend & ai-service yang tidak serempak tidak mematikan
   * fitur, tapi tetap terlihat di log.
   */
  async assertDimension(): Promise<EmbeddingHealth> {
    const h = this.cachedHealth ?? (await this.health());
    if (h.dim !== this.expectedDimension) {
      throw new Error(
        `Dimensi ai-service (${h.dim}, model ${h.model}) tidak cocok dengan ` +
          `VECTOR_DIMENSION (${this.expectedDimension}). Kolom products.embedding ` +
          `harus di-recreate dengan dimensi yang benar sebelum melanjutkan.`,
      );
    }
    if (h.model !== this.modelName) {
      this.logger.warn(
        `ai-service melaporkan model "${h.model}" sementara backend memakai ` +
          `"${this.modelName}". Embedding lama akan di-embed ulang; pastikan ` +
          `EMBEDDING_PREPROCESS_TAG & AI_MODEL_NAME sinkron dengan ai-service.`,
      );
    }
    return h;
  }

  // ─── Embedding ─────────────────────────────────────────────────
  /** Batch embed. `images` = data URL atau URL http(s) publik. */
  async embed(images: EmbedInput[]): Promise<EmbedResult> {
    if (images.length === 0) {
      return {
        vectors: [],
        model: this.modelName,
        dim: this.expectedDimension,
        failed: [],
      };
    }
    const result = await this.request<EmbedResult>("POST", "/embed", { images });
    if (result.dim !== this.expectedDimension) {
      throw new Error(
        `ai-service mengembalikan dim ${result.dim}, diharapkan ${this.expectedDimension}`,
      );
    }
    return { ...result, failed: result.failed ?? [] };
  }

  /** Embed satu gambar. Melempar kalau gagal (tidak mengembalikan null). */
  async embedOne(image: EmbedInput): Promise<number[]> {
    const res = await this.embed([image]);
    if (res.failed.length > 0 || res.vectors.length === 0) {
      throw new Error(
        res.failed[0]?.reason ?? "ai-service gagal meng-embed gambar",
      );
    }
    return res.vectors[0];
  }

  // ─── Embedding TEKS ────────────────────────────────────────────
  /**
   * Embed teks lewat text tower SigLIP — ruang vektor yang SAMA dengan gambar,
   * jadi hasilnya bisa langsung dibandingkan ke `products.embedding`.
   *
   * PENTING: skala jaraknya berbeda dari gambar↔gambar (teks↔gambar mendarat di
   * ~0.86–1.01), jadi ambang gate gambar TIDAK berlaku. Lihat TEXT_ABS_MAX di
   * image-search.gate.ts.
   */
  async embedText(texts: EmbedTextInput[]): Promise<EmbedResult> {
    if (texts.length === 0) {
      return {
        vectors: [],
        model: this.modelName,
        dim: this.expectedDimension,
        failed: [],
      };
    }
    const result = await this.request<EmbedResult>("POST", "/embed-text", {
      texts,
    });
    if (result.dim !== this.expectedDimension) {
      throw new Error(
        `ai-service mengembalikan dim ${result.dim}, diharapkan ${this.expectedDimension}`,
      );
    }
    return { ...result, failed: result.failed ?? [] };
  }

  /** Embed satu teks. Melempar kalau gagal. */
  async embedTextOne(text: EmbedTextInput): Promise<number[]> {
    const res = await this.embedText([text]);
    if (res.vectors.length === 0) {
      throw new Error(
        res.failed[0]?.reason ?? "ai-service gagal meng-embed teks",
      );
    }
    return res.vectors[0];
  }

  /**
   * Format vektor ke literal pgvector: "[0.1,0.2,...]".
   * Dikirim ke Postgres sebagai BOUND PARAMETER string lalu di-cast ::vector —
   * bukan interpolasi SQL.
   */
  static toVectorLiteral(vec: number[]): string {
    return `[${vec.join(",")}]`;
  }
}

