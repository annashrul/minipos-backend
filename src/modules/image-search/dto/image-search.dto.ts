import { z } from "zod";

// Cari produk berdasarkan FOTO memakai vektor pgvector (bukan AI vision).
export const ImageSearchQuerySchema = z.object({
  // data URL "data:image/jpeg;base64,..." — frontend sudah resize ke 768px
  // (fileToResizedDataUrl). Batas 3MB selaras dengan SearchByImageSchema dan
  // di bawah body limit 5mb di main.ts.
  image: z.string().min(1).max(3_000_000),
  limit: z.coerce.number().int().positive().max(50).optional(),
  // Override PLAFON absolut cosine distance. Hasil tetap harus lolos uji rasio;
  // ini hanya batas keras tambahan. Default: IMAGE_SEARCH_ABS_MAX.
  maxDistance: z.coerce.number().min(0).max(2).optional(),
  // Override rasio maksimum distance/median(jarak query ke seluruh katalog).
  // Ini gate utamanya — lihat image-search.gate.ts. Default:
  // IMAGE_SEARCH_RATIO_MAX. Dipakai untuk debugging/kalibrasi.
  maxRatio: z.coerce.number().min(0).max(2).optional(),
});
export type ImageSearchQueryDto = z.infer<typeof ImageSearchQuerySchema>;

// Cari produk dari DESKRIPSI TEKS memakai text tower SigLIP terhadap
// products.embedding. Jaring terakhir Search-by-Image: dipakai dengan deskripsi
// yang dibaca LLM vision dari foto ketika jalur gambar↔gambar tidak menemukan
// apa pun. Ambangnya BEDA dari jalur gambar — lihat DEFAULT_TEXT_ABS_MAX.
export const ImageSearchTextQuerySchema = z.object({
  text: z.string().trim().min(2).max(300),
  limit: z.coerce.number().int().positive().max(50).optional(),
  // Override ambang absolut cosine distance teks↔gambar. Default:
  // IMAGE_SEARCH_TEXT_ABS_MAX. Dipakai untuk debugging/kalibrasi.
  maxDistance: z.coerce.number().min(0).max(2).optional(),
});
export type ImageSearchTextQueryDto = z.infer<typeof ImageSearchTextQuerySchema>;

export type ImageSearchHit = {
  id: string;
  code: string;
  name: string;
  imageUrl: string | null;
  categoryName: string | null;
  sellingPrice: number;
  stock: number;
  unit: string;
  /** Cosine distance 0..2. 0 = identik. */
  distance: number;
  /** 1 - distance, dibatasi 0..1 — lebih intuitif untuk UI. */
  similarity: number;
  /**
   * distance / median jarak query ke seluruh katalog. Makin kecil makin
   * menonjol dibanding katalog lainnya. 0 = median tidak tersedia.
   */
  ratio: number;
};

/** Sebaran jarak query — dasar penyaringan hasil. Berguna untuk debugging. */
export type ImageSearchStats = {
  /** Median jarak query ke seluruh katalog company. null = tidak dihitung. */
  median: number | null;
  /** Jumlah produk ber-embedding yang jadi dasar median. */
  sampleSize: number;
  /** Ambang distance efektif yang dipakai menyaring hasil. */
  gate: number;
  /** Dasar penentuan gate: ratio | ceiling | floor | small-catalog. */
  basis: string;
};

export type ImageSearchResponse = {
  /** Hasil yang LOLOS gate — boleh diklaim sebagai "produk ini". */
  hits: ImageSearchHit[];
  /**
   * Tetangga terdekat yang GAGAL gate, hanya terisi kalau `hits` kosong.
   * Bukan klaim kecocokan — UI menampilkannya sebagai "Gambar serupa" supaya
   * query kategori (mis. botol air mineral tanpa label vs `aqua gelas`) tidak
   * berujung buntu. Lihat catatan tier "serupa" di image-search.gate.ts.
   */
  near: ImageSearchHit[];
  /** Produk ber-embedding di company ini. 0 = katalog belum di-backfill. */
  indexed: number;
  model: string;
  /** Hanya ada kalau pencarian benar-benar dijalankan (tidak ada `warning`). */
  stats?: ImageSearchStats;
  /** Diisi kalau fitur tidak bisa jalan (ai-service mati / belum backfill). */
  warning?: string;
};

// Status kesiapan index per company — dipakai UI untuk memutuskan apakah
// tombol "cari via foto (vektor)" ditampilkan.
export type ImageSearchStatusResponse = {
  totalProducts: number;
  withImage: number;
  indexed: number;
  pending: number;
  staleCount: number;
  model: string | null;
  serviceReachable: boolean;
  /** indexed > 0 && serviceReachable */
  ready: boolean;
};
