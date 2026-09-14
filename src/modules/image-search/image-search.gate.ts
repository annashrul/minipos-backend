// Ambang penerimaan hasil Search-by-Image.
//
// MASALAH DENGAN AMBANG ABSOLUT (perilaku lama, IMAGE_SEARCH_MAX_DISTANCE=0.20)
// -----------------------------------------------------------------------------
// 0.20 dikalibrasi dari foto katalog yang DIDISTORSI (rotate/blur/gelap) — pada
// data itu p90 self-distance = 0.14, jadi 0.20 terasa aman. Tapi foto BARU dari
// kamera user (bukan copy foto katalog) untuk produk yang sama mendarat di
// 0.21–0.30, sementara p01 jarak antar-pasangan katalog = 0.2489. Dua sebaran
// itu TUMPANG TINDIH, jadi tidak ada satu konstanta pun yang benar: 0.20
// membuang hit yang benar, 0.30 mulai menarik produk asing.
//
// SINYAL YANG BISA DIPAKAI
// -----------------------------------------------------------------------------
// Yang membedakan "ketemu" dari "tidak ada" bukan nilai absolutnya, tapi JURANG
// antara hit terbaik dan sebaran jarak query itu sendiri (uji rasio ala Lowe):
//
//   ratio = distance / median(jarak query ini ke SELURUH katalog company)
//
// Terukur pada katalog 68 produk + 8 gambar produk company lain (tidak ada
// padanannya) memakai preprocessing tp3:
//   - benar-ada-di-katalog : ratio 0.185 dan 0.466
//   - tidak-ada-di-katalog : ratio 0.732, 0.781, 0.824, 0.860, 0.866, 0.869, 0.876
// Terpisah bersih; titik tengahnya ~0.60 → DEFAULT_RATIO_MAX.
//
// Median (bukan mean/min) karena robust: beberapa hit yang benar tidak menggeser
// median katalog. MAD/z-score SUDAH DIUJI dan DITOLAK — z positif (-9.6) dan z
// negatif (-6.1) saling tumpang tindih, jadi MAD hanya menambah biaya sort tanpa
// menambah daya pisah.
//
// Ratio saja tidak cukup di dua ujung, jadi ada plafon & lantai absolut:
//   - PLAFON  (absMax)  : kalau median sangat tinggi (foto sangat asing bagi
//     katalog), 0.60 x median bisa melewati wilayah "jelas beda produk".
//   - LANTAI  (absFloor): kalau katalog dipenuhi produk yang mirip satu sama
//     lain, median jadi kecil dan gate relatif bisa lebih ketat dari akurasi
//     model. Jarak di bawah lantai selalu diterima — nilainya di bawah p90
//     self-distance foto terdistorsi (0.14 → 0.18 dengan margin), jadi tetap
//     lebih ketat daripada perilaku lama.

/** Jumlah hasil default kalau IMAGE_SEARCH_LIMIT tidak di-set. */
export const DEFAULT_LIMIT = 12;

/** Rasio maksimum distance/median. Gate utama. */
export const DEFAULT_RATIO_MAX = 0.6;

/** Plafon absolut distance, menahan gate saat median tinggi. */
export const DEFAULT_ABS_MAX = 0.45;

/** Lantai absolut distance yang selalu diterima, menahan gate saat median kecil. */
export const DEFAULT_ABS_FLOOR = 0.18;

/**
 * Minimum baris ber-embedding supaya median layak dipakai. Di bawah ini median
 * bisa terdiri dari hit yang benar itu sendiri → rasio jadi menyesatkan.
 */
export const MIN_STATS_SAMPLE = 10;

/** Ambang absolut untuk katalog yang terlalu kecil untuk diukur secara relatif. */
export const SMALL_CATALOG_MAX = 0.3;

/** Kenapa `gate` bernilai demikian — ikut dikirim ke response untuk debugging. */
export type GateBasis =
  /** gate = ratioMax x median */
  | "ratio"
  /** gate ditahan plafon absolut */
  | "ceiling"
  /** gate diangkat lantai absolut */
  | "floor"
  /** katalog < MIN_STATS_SAMPLE → ambang absolut */
  | "small-catalog"
  /** jalur TEKS: ambang absolut DEFAULT_TEXT_ABS_MAX (skala jarak berbeda) */
  | "text-abs";

export type GateDecision = { gate: number; basis: GateBasis };

export type GateOptions = {
  /** Median jarak query ke seluruh katalog. null = tidak tersedia. */
  median: number | null;
  /** Jumlah baris yang jadi dasar median. */
  sampleSize: number;
  ratioMax: number;
  absMax: number;
  absFloor: number;
};

/**
 * Hitung ambang jarak efektif untuk satu query. Fungsi murni — seluruh
 * kalibrasi di atas terkunci oleh image-search.gate.spec.ts.
 */
export function resolveGate(opts: GateOptions): GateDecision {
  const { median, sampleSize, ratioMax, absMax, absFloor } = opts;

  if (
    median === null ||
    !Number.isFinite(median) ||
    median <= 0 ||
    sampleSize < MIN_STATS_SAMPLE
  ) {
    return { gate: Math.min(absMax, SMALL_CATALOG_MAX), basis: "small-catalog" };
  }

  const relative = ratioMax * median;
  if (relative > absMax) return { gate: absMax, basis: "ceiling" };
  // Lantai tidak boleh menembus plafon: absMax tetap batas keras.
  if (relative < absFloor) {
    return { gate: Math.min(absMax, absFloor), basis: "floor" };
  }
  return { gate: relative, basis: "ratio" };
}

/**
 * Rasio jarak terhadap median query. 0 kalau median tidak tersedia — bukan
 * NaN/Infinity, supaya aman diserialisasi ke JSON.
 */
export function ratioOf(distance: number, median: number | null): number {
  if (median === null || !Number.isFinite(median) || median <= 0) return 0;
  return distance / median;
}

// TIER "SERUPA" (near-miss) — kenapa gate saja tidak cukup
// -----------------------------------------------------------------------------
// Kalibrasi di atas hanya punya DUA kelas: "produk yang sama, foto beda"
// (ratio 0.185–0.466) dan "produk yang sama sekali tidak ada di katalog"
// (0.732–0.876). Ada KELAS KETIGA yang tidak pernah masuk dataset itu:
//
//   produk BEDA tapi SEKATEGORI — mis. foto botol air mineral generik tanpa
//   label sementara katalog hanya punya `aqua gelas`.
//
// Kelas ini mendarat di wilayah negatif, jadi gate membuangnya dan user hanya
// melihat "tidak ada di katalog" — padahal tetangga terdekatnya justru yang dia
// cari. Rasio TIDAK bisa memisahkan kelas ketiga ini dari "tidak berhubungan"
// (keduanya ~0.73+), jadi tidak ada ambang yang bisa dikalibrasi untuk itu.
//
// Solusinya bukan melonggarkan gate (itu merusak presisi klaim "persis"),
// tapi TIDAK MEMBUANG tetangga terdekat: hasil yang gagal gate dikembalikan
// terpisah sebagai kandidat "Gambar serupa" — berbasis PERINGKAT, bukan ambang.
// UI menampilkannya di section terpisah sehingga tidak pernah mengklaim cocok.

/**
 * Jumlah maksimum kandidat "serupa" yang dikembalikan saat TIDAK ADA hit yang
 * lolos gate. Sengaja kecil supaya section itu tetap terbaca sebagai petunjuk,
 * bukan daftar acak. `IMAGE_SEARCH_NEAR_LIMIT=0` mematikannya (perilaku lama:
 * gagal gate = nol hasil).
 */
export const DEFAULT_NEAR_LIMIT = 6;

/**
 * Batas KEWAJARAN untuk tier "serupa" — bukan angka kalibrasi. Di atas ini
 * vektor praktis tidak berhubungan (cosine distance mendekati ortogonal 1.0),
 * jadi menampilkannya hanya jadi derau. Negatif terukur mendarat di ~0.44–0.55,
 * masih di bawah batas ini: memang disengaja, tetangga terdekat tetap tampil.
 */
export const NEAR_ABS_MAX = 0.75;

/**
 * `true` bila sebuah hasil gagal gate tapi masih layak ditawarkan sebagai
 * "Gambar serupa". Fungsi murni.
 */
export function isNearMiss(
  distance: number,
  gate: number,
  absMaxNear: number = NEAR_ABS_MAX,
): boolean {
  if (!Number.isFinite(distance)) return false;
  return distance > gate && distance <= absMaxNear;
}

// GATE JALUR TEKS (SigLIP text tower → products.embedding)
// -----------------------------------------------------------------------------
// Kenapa ada jalur teks: gambar↔gambar hanya bisa menemukan produk yang FOTONYA
// mirip. Foto botol air mineral generik tanpa label vs foto katalog `aqua gelas`
// (cup ber-label AQUA biru) terukur d=0.4366, PERINGKAT 40 dari 69 — model
// memang tidak melihat keduanya mirip, jadi tidak ada ambang yang bisa menolong.
// Sementara itu LLM vision SUDAH membaca objeknya dengan benar ("air mineral
// botol plastik tanpa label"), tapi teks itu dicocokkan ke NAMA produk sehingga
// skornya 0.031 (ambang serupa 0.30) — `aqua gelas` tidak punya token "air".
//
// SigLIP punya text tower di ruang vektor yang SAMA, jadi deskripsi itu bisa
// dicocokkan ke FOTO produk. Terukur pada katalog yang sama:
//   teks "air mineral botol plastik tanpa label" → `aqua gelas` PERINGKAT 1/69
//
// KALIBRASI (69 produk, 13 query positif + 9 negatif):
//   positif (top-1 benar)  : d1 0.8596 .. 0.9284   (max: deskripsi asli user)
//   negatif (tidak ada)    : d1 0.9605 .. 1.0081   (min: "obat batuk sirup")
// Terpisah BERSIH dengan jurang 0.032 → ambang = titik tengahnya, 0.945.
//
// Berbeda dari gambar↔gambar, di sini yang bekerja justru ambang ABSOLUT:
//   - ratio ke median TUMPANG TINDIH (positif ≤0.9214, negatif ≥0.9050)
//   - rasio d1/d2 juga tumpang tindih (kueri kategori seperti "bearing bola"
//     memang punya beberapa padanan sah, jadi d1≈d2)
// Sebabnya: jarak teks↔gambar diukur terhadap text tower yang tetap, bukan
// terhadap keunikan satu foto katalog, sehingga sebarannya jauh lebih stabil.

/** Ambang absolut cosine distance teks↔gambar. Titik tengah kalibrasi. */
export const DEFAULT_TEXT_ABS_MAX = 0.945;

/** Jumlah maksimum hasil jalur teks. Kecil karena ini saran, bukan klaim. */
export const DEFAULT_TEXT_LIMIT = 6;

/**
 * `true` bila hasil jalur TEKS cukup dekat untuk ditawarkan. Fungsi murni —
 * kalibrasi di atas dikunci image-search.gate.spec.ts.
 */
export function isTextMatch(
  distance: number,
  absMax: number = DEFAULT_TEXT_ABS_MAX,
): boolean {
  if (!Number.isFinite(distance)) return false;
  return distance <= absMax;
}
