/**
 * Pencocokan teks ↔ katalog produk (tanpa AI, tanpa DB).
 *
 * Dipakai dua jalur pencarian di Monitor Stok:
 *   1. normalize-search (voice) — memastikan ucapan user tidak "dilebarkan" AI
 *      jadi produk spesifik yang tidak diucapkan.
 *   2. search-by-image (vision) — memetakan deskripsi bebas dari model vision
 *      ke nama produk yang BENAR-BENAR ada di katalog.
 *
 * Kenapa perlu: sebelumnya kedua jalur mengandalkan LLM untuk "menyebut nama
 * persis dari katalog", lalu frontend mencocokkan dengan `String.includes()`.
 * Dua-duanya rapuh — LLM menebak nama yang tidak diucapkan (voice) dan substring
 * persis gagal untuk variasi ejaan/urutan kata ("Aqua 600ml" vs "Aqua Air
 * Mineral 600 ml" → 0 hasil). Skoring di sini deterministik, bisa diuji, dan
 * tidak menambah latensi.
 */

/** Kata sambung/pengisi yang tidak membedakan produk — dibuang saat tokenisasi. */
const STOPWORDS = new Set([
  "dan",
  "atau",
  "untuk",
  "dengan",
  "per",
  "yang",
  "the",
  "of",
  "and",
  "for",
  "with",
]);

/** Satuan/ukuran — muncul di hampir semua nama produk, jadi bukan pembeda kuat. */
const UNIT_TOKENS = new Set([
  "ml",
  "l",
  "ltr",
  "liter",
  "gr",
  "g",
  "gram",
  "kg",
  "mg",
  "cc",
  "pcs",
  "pc",
  "pak",
  "pack",
  "sachet",
  "dus",
  "box",
  "lusin",
  "rim",
  "slop",
  "renceng",
]);

/**
 * Skor minimum agar sebuah kata kunci dianggap SUDAH menemukan produk di
 * katalog. Dipakai `isGrounded` / `pickGroundedAlternative` untuk melewati LLM.
 */
export const GROUNDED_SCORE = 0.7;
/** Skor minimum untuk dianggap produk yang dimaksud (hasil persis). */
export const EXACT_MATCH_SCORE = 0.6;
/**
 * Batas RELATIF terhadap skor tertinggi untuk section "persis".
 *
 * Ambang absolut saja tidak cukup: foto "Aqua 600 ml" membuat "Aqua Air Mineral
 * 1500 ml" ikut lolos 0.6 dan muncul sebagai hasil persis. Dengan band relatif,
 * hanya kandidat yang sekelas dengan juara yang masuk "persis"; sisanya turun ke
 * "serupa" — tetap terlihat, tapi tidak mengklaim kecocokan.
 */
export const EXACT_MATCH_RELATIVE = 0.92;
/** Skor minimum untuk masuk daftar "produk serupa". */
export const SIMILAR_MATCH_SCORE = 0.3;

/**
 * Normalisasi untuk pencocokan: lowercase, buang diakritik & tanda baca, dan
 * PISAHKAN angka dari huruf supaya "600ml" cocok dengan "600 ml".
 */
export function normalizeForMatch(input: string): string {
  return (input || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Token pembeda: ≥2 karakter, bukan stopword, unik, urutan dipertahankan. */
export function matchTokens(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of normalizeForMatch(input).split(" ")) {
    if (t.length < 2 || STOPWORDS.has(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Kemiripan bigram (Sørensen–Dice) pada teks tanpa spasi. 0..1. */
export function diceSimilarity(a: string, b: string): number {
  const sa = normalizeForMatch(a).replace(/ /g, "");
  const sb = normalizeForMatch(b).replace(/ /g, "");
  if (!sa || !sb) return 0;
  if (sa === sb) return 1;
  if (sa.length < 2 || sb.length < 2) return 0;

  const bigrams = new Map<string, number>();
  for (let i = 0; i < sa.length - 1; i++) {
    const g = sa.slice(i, i + 2);
    bigrams.set(g, (bigrams.get(g) ?? 0) + 1);
  }
  let hit = 0;
  for (let i = 0; i < sb.length - 1; i++) {
    const g = sb.slice(i, i + 2);
    const n = bigrams.get(g) ?? 0;
    if (n > 0) {
      bigrams.set(g, n - 1);
      hit++;
    }
  }
  return (2 * hit) / (sa.length - 1 + (sb.length - 1));
}

/** Token dianggap sama bila identik atau salah satu prefix yang lain (≥4 char). */
function tokenEquivalent(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 4 && b.startsWith(a)) return true;
  if (b.length >= 4 && a.startsWith(b)) return true;
  return false;
}

/** Bobot token: satuan/angka lemah, kata pembeda (merek/varian) penuh. */
function tokenWeight(token: string): number {
  if (UNIT_TOKENS.has(token)) return 0.25;
  if (/^\d+$/.test(token)) return 0.5;
  return 1;
}

/**
 * Skor kemiripan kata kunci terhadap satu nama produk. 0..1.
 *
 * Gabungan tiga sinyal supaya tidak gampang dibohongi salah satu:
 *   - recall token kueri BERBOBOT (paling berat: semua kata pembeda yang
 *     diucapkan harus ada; satuan seperti "ml"/"kg" nyaris tidak dihitung
 *     karena muncul di hampir semua nama produk)
 *   - F1 token (menghukum nama produk yang jauh lebih panjang dari kueri)
 *   - Dice bigram (menangkap salah ejaan / imbuhan)
 */
export function scoreCandidate(query: string, candidate: string): number {
  const qn = normalizeForMatch(query);
  const cn = normalizeForMatch(candidate);
  if (!qn || !cn) return 0;
  if (qn === cn) return 1;
  // Substring = pasti relevan (mis. "goreng" di "Mie Goreng Jawa").
  if (cn.includes(qn) || qn.includes(cn)) return 0.9;

  const qt = matchTokens(qn);
  const ct = matchTokens(cn);
  if (qt.length === 0 || ct.length === 0) return diceSimilarity(qn, cn);

  const matched = qt.filter((t) => ct.some((c) => tokenEquivalent(t, c)));
  const totalWeight = qt.reduce((sum, t) => sum + tokenWeight(t), 0);
  const hitWeight = matched.reduce((sum, t) => sum + tokenWeight(t), 0);
  const recall = totalWeight > 0 ? hitWeight / totalWeight : 0;
  const precision = matched.length / ct.length;
  const f1 =
    recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : 0;
  const dice = diceSimilarity(qn, cn);
  return 0.6 * recall + 0.2 * f1 + 0.2 * dice;
}

/** Skor terbaik sebuah kata kunci terhadap seluruh katalog. */
export function bestScore(query: string, candidates: string[]): number {
  let best = 0;
  for (const c of candidates) {
    const s = scoreCandidate(query, c);
    if (s > best) best = s;
    if (best === 1) break;
  }
  return best;
}

/** Jumlah produk katalog yang cocok kuat dengan kata kunci. */
export function countMatchingCandidates(
  query: string,
  candidates: string[],
): number {
  let n = 0;
  for (const c of candidates) {
    if (scoreCandidate(query, c) >= GROUNDED_SCORE) n++;
  }
  return n;
}

/** `true` bila kata kunci sudah menemukan produk di katalog (tanpa bantuan AI). */
export function isGrounded(query: string, candidates: string[]): boolean {
  if (!query.trim() || candidates.length === 0) return false;
  return countMatchingCandidates(query, candidates) > 0;
}

/**
 * AI hanya boleh MENGOREKSI kata, tidak boleh MENAMBAH kata.
 *
 * Kalau seluruh token ucapan asli masih utuh di hasil AI TAPI ada token baru,
 * berarti AI tidak mengoreksi apa pun — hanya melebarkan kueri jadi produk
 * spesifik yang tidak diucapkan ("goreng" → "Kentang Goreng Medium"), sehingga
 * produk lain yang relevan hilang dari hasil.
 */
export function isKeywordInflation(raw: string, normalized: string): boolean {
  const rawTokens = matchTokens(raw);
  const outTokens = matchTokens(normalized);
  if (rawTokens.length === 0 || outTokens.length <= rawTokens.length) {
    return false;
  }
  return rawTokens.every((t) => outTokens.some((o) => tokenEquivalent(t, o)));
}

/**
 * Pilih hipotesis STT (N-best) yang paling cocok dengan katalog. Dipakai sebelum
 * memanggil AI: kalau salah satu alternatif sudah ketemu di katalog, tidak perlu
 * LLM sama sekali.
 */
export function pickGroundedAlternative(
  alternatives: string[],
  candidates: string[],
): string | null {
  let best: { text: string; score: number } | null = null;
  for (const alt of alternatives) {
    const text = alt.trim();
    if (!text) continue;
    const score = bestScore(text, candidates);
    if (score >= GROUNDED_SCORE && (!best || score > best.score)) {
      best = { text, score };
    }
  }
  return best?.text ?? null;
}

/** Kata kunci berbobot — hasil vision (primary/brand/keywords/similar). */
export type WeightedQuery = { text: string; weight: number };

/**
 * Ranking katalog terhadap beberapa kata kunci berbobot. Skor akhir per produk =
 * nilai tertinggi dari `skor kemiripan × bobot kata kunci`, jadi satu kata kunci
 * berbobot tinggi (nama produk dari vision) tidak tertimbun banyak kata kunci
 * lemah (kategori/warna).
 */
export function rankCandidates(
  queries: WeightedQuery[],
  candidates: string[],
): { name: string; score: number }[] {
  const scored = new Map<string, number>();
  for (const candidate of candidates) {
    const name = candidate.trim();
    if (!name) continue;
    let best = 0;
    for (const q of queries) {
      if (!q.text.trim()) continue;
      const s = scoreCandidate(q.text, name) * q.weight;
      if (s > best) best = s;
    }
    const prev = scored.get(name) ?? 0;
    if (best > prev) scored.set(name, best);
  }
  return [...scored.entries()]
    .map(([name, score]) => ({ name, score }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

