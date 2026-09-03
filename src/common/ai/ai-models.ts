import type { ConfigService } from "@nestjs/config";

/**
 * SATU-SATUNYA sumber ID model AI di backend.
 *
 * Kenapa dipusatkan & di-drive dari .env: provider free-tier (Groq / Google /
 * OpenRouter) rutin men-decommission model tanpa pemberitahuan. Saat itu terjadi
 * fitur AI mati SENYAP (HTTP 404/400 tertelan di catch). Dengan semua ID model
 * ada di .env, perbaikannya cukup edit .env + restart — tanpa ubah kode dan
 * tanpa redeploy.
 *
 * Nilai DEFAULTS di bawah sudah diverifikasi HIDUP (cek langsung ke endpoint
 * /models tiap provider). Kalau salah satu mati, override lewat .env dan
 * update default di sini.
 */
const DEFAULTS = {
  // ── Groq ────────────────────────────────────────────────────────────────
  /** Chat AI assistant (tool calling). gpt-oss-20b: latensi paling konsisten. */
  GROQ_MODEL: "openai/gpt-oss-20b",
  /**
   * Rantai fallback saat model utama kena rate-limit harian (tiap model punya
   * kuota TPD sendiri). Comma-separated, dicoba berurutan.
   * CATATAN: llama-3.3-70b-versatile & llama-3.1-8b-instant DIHAPUS dari
   * default — keduanya sudah tidak ada di Groq (HTTP 404).
   */
  GROQ_FALLBACK_MODELS: "openai/gpt-oss-120b,openai/gpt-oss-20b",
  /** Normalisasi hasil voice-to-text jadi kata kunci pencarian. */
  GROQ_NORMALIZE_MODEL: "qwen/qwen3.8-27b",
  /** Vision — cari produk dari foto (butuh input_modalities text+image). */
  GROQ_VISION_MODEL: "qwen/qwen3.8-27b",
  /** Generate deskripsi produk (butuh sintesis kalimat lebih bagus). */
  GROQ_DESCRIPTION_MODEL: "openai/gpt-oss-120b",
  /** Default model chatbot WhatsApp; bisa dioverride per-company lewat DB. */
  WHATSAPP_BOT_MODEL: "openai/gpt-oss-20b",

  // ── Google AI Studio (Gemini) ───────────────────────────────────────────
  /** gemini-2.0-flash sudah "no longer available to new users" (HTTP 404). */
  GEMINI_MODEL: "gemini-3.5-flash",

  // ── OpenRouter ──────────────────────────────────────────────────────────
  /** Vision fallback. google/gemini-2.0-flash-001 sudah delisted. */
  OPENROUTER_VISION_MODEL: "google/gemini-3.5-flash",

  // ── Cloudflare Workers AI ───────────────────────────────────────────────
  /** Vision fallback (free tier 10k req/bulan). */
  CLOUDFLARE_VISION_MODEL: "@cf/llava-hf/llava-1.5-7b-hf",

  // ── justDoWorker (relay New API) ────────────────────────────────────────
  /** Model teks/vision relay. Tersedia: claude-opus-5, claude-opus-5-thinking. */
  JUSTDOWORKER_MODEL: "claude-opus-5",
} as const;

export type AiModelKey = keyof typeof DEFAULTS;

/** Default publik — dipakai klien yang punya aturan fallback sendiri. */
export const AI_MODEL_DEFAULTS = DEFAULTS;

/** Ambil satu ID model dari env, jatuh ke default terverifikasi kalau kosong. */
export function aiModel(config: ConfigService, key: AiModelKey): string {
  return (config.get<string>(key) || DEFAULTS[key]).trim();
}

/**
 * Ambil daftar ID model (env comma-separated) untuk rantai fallback.
 * `head` diletakkan paling depan dan duplikat dibuang, supaya model pilihan
 * user/DB selalu dicoba pertama tanpa dicoba dua kali.
 */
export function aiModelChain(
  config: ConfigService,
  key: AiModelKey,
  head?: string,
): string[] {
  const list = (config.get<string>(key) || DEFAULTS[key])
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  const chain = head ? [head.trim(), ...list] : list;
  return chain.filter((m, i, arr) => m.length > 0 && arr.indexOf(m) === i);
}

/**
 * `reasoning_effort` yang AMAN untuk model apa pun di rantai.
 *
 * Groq menerima nilai berbeda per keluarga model:
 *   - qwen3      : "none" | "default"            → "low" ditolak HTTP 400
 *   - gpt-oss    : "low" | "medium" | "high"     → "none" ditolak HTTP 400
 *
 * Selain itu qwen3 adalah reasoning model: kalau reasoning dibiarkan menyala,
 * seluruh budget max_tokens bisa habis di blok <think> dan `content` balik
 * KOSONG. Karena ID model sekarang bisa diganti dari .env, nilai ini WAJIB
 * diturunkan dari nama model — bukan dihardcode.
 */
export function safeReasoningEffort(model: string): "none" | "low" {
  return /qwen/i.test(model) ? "none" : "low";
}

/**
 * Error "model ini tidak ada / sudah dimatikan" (Groq 404 `model_not_found`,
 * 400 `model_decommissioned`, dsb).
 *
 * Dipakai agar rantai fallback LANJUT ke model berikutnya, bukan langsung
 * melempar error. Sebelumnya hanya rate-limit (429) yang memicu pindah model,
 * jadi satu ID model mati di kepala rantai (mis. pilihan lama yang tersimpan di
 * DB per-company) langsung mematikan seluruh balasan AI padahal ada model lain
 * yang sehat.
 */
export function isModelUnavailableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; message?: string };
  const msg = (e.message ?? "").toLowerCase();
  if (/decommission|model_not_found|does not exist|no longer available|unknown model|invalid model/.test(msg))
    return true;
  // 404 dari endpoint chat/completions praktis selalu berarti model tak dikenal.
  return e.status === 404;
}

/**
 * Error KREDENSIAL provider (401/403, invalid API key, key dicabut).
 *
 * Beda dari rate-limit: mencoba model lain di provider yang SAMA tidak akan
 * menolong — yang benar adalah pindah ke provider berikutnya. Tanpa deteksi ini,
 * satu `GROQ_API_KEY` yang kedaluwarsa membuat AI assistant chat mati total
 * padahal Gemini / justDoWorker masih hidup.
 */
export function isProviderAuthError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; message?: string };
  if (e.status === 401 || e.status === 403) return true;
  const msg = (e.message ?? "").toLowerCase();
  return /invalid[_ ]?api[_ ]?key|invalid api key|unauthorized|forbidden|authentication|api key not found|permission denied/.test(
    msg,
  );
}
