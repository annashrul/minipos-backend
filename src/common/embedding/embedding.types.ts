// Tipe kontrak ai-service (FastAPI). Sengaja dipisah dari client supaya
// bisa di-import service lain tanpa menarik dependency Nest.

export type EmbeddingHealth = {
  status: string;
  /**
   * Identitas embedding yang dilaporkan ai-service:
   * `"<nama model>+<tag preprocessing>"`, mis.
  * "google/siglip-base-patch16-224+tp3". Harus == EmbeddingClient.modelName.
   */
  model: string;
  /** Dimensi vektor yang dihasilkan model. Harus == VECTOR_DIMENSION. */
  dim: number;
  /** Tag preprocessing saja (tanpa nama model). Opsional: ai-service lama tidak mengirimnya. */
  preprocess?: string;
};

export type EmbedResult = {
  /** Vektor L2-normalized, panjang == dim. */
  vectors: number[][];
  model: string;
  dim: number;
  /**
   * Index input yang GAGAL di-embed (mis. URL 404 / bukan gambar). Vektornya
   * TIDAK ada di `vectors`; pakai `failed` untuk mapping ulang ke input.
   */
  failed: Array<{ index: number; reason: string }>;
};

/** Sumber gambar: data URL / URL http(s) publik (mis. Cloudinary). */
export type EmbedInput = string;

/**
 * Teks bebas untuk `/embed-text`. Di-encode oleh TEXT TOWER SigLIP ke ruang
 * vektor yang SAMA dengan gambar, jadi hasilnya bisa dibandingkan langsung ke
 * `products.embedding`. Catatan: skala jarak teks↔gambar berbeda dari
 * gambar↔gambar — jangan pakai ambang yang sama (lihat image-search.gate.ts).
 */
export type EmbedTextInput = string;
